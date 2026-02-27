#!/usr/bin/env node
import { Command } from 'commander';
import { createRuntime, createServerProxy, describeConnectionIssue } from 'mcporter';
import type { CallResult } from 'mcporter';
import { spawn } from 'node:child_process';
import { printResult, unwrapResult } from './xcode-output.ts';
import { copyPreviewToOutput, findPreviewPath } from './xcode-preview.ts';
import { parseTestSpecifier } from './xcode-test.ts';
import { renderLsTree } from './xcode-tree.ts';
import { startMcpBridge } from './xcode-mcp.ts';
import type { CommonOpts, ClientContext } from './xcode-types.ts';

const SERVER_NAME = 'xcode-tools';
const DEFAULT_PORT = '49321';
const DEFAULT_URL = `http://localhost:${DEFAULT_PORT}/mcp`;

const program = new Command();
program
  .name('xcode-mcp')
  .description('Friendly Xcode MCP CLI for browsing, editing, building, and testing projects.')
  .option('--url <url>', `MCP endpoint (default: ${DEFAULT_URL})`)
  .option('--tab <tabIdentifier>', 'Default tab identifier for commands that need it')
  .option('-t, --timeout <ms>', 'Call timeout in milliseconds', '60000')
  .option('--json', 'Output JSON (shorthand for --output json)')
  .option('-o, --output <format>', 'text | json', parseOutputFormat, 'text');

program.addHelpText(
  'after',
  `
Tab selection:
  Commands that require tabIdentifier will use --tab (or XCODE_TAB_ID) when provided.
  If neither is provided and exactly one Xcode tab is open, that tabIdentifier is auto-selected.

Examples:
  # Start a local bridge in one terminal
  xcode-mcp bridge

  # Discover tabIdentifier values
  xcode-mcp windows

  # Build using a known Xcode tab identifier
  xcode-mcp --tab <tabIdentifier> build
`,
);

program
  .command('tools')
  .description('List all available Xcode MCP tools')
  .action(async () => {
    await withClient(async (ctx) => {
      const tools = await ctx.proxy.listTools({ includeSchema: false });
      if (ctx.output === 'json') {
        console.log(JSON.stringify(tools, null, 2));
        return;
      }
      for (const tool of tools) {
        console.log(`${tool.name}${tool.description ? ` - ${tool.description}` : ''}`);
      }
    });
  });

program
  .command('windows')
  .description('List Xcode windows/workspaces and tab identifiers')
  .action(async () => {
    await withClient(async (ctx) => {
      const result = await ctx.call('XcodeListWindows');
      printResult(result, ctx.output);
    });
  });

program
  .command('bridge')
  .description('Run local HTTP MCP bridge backed by `xcrun mcpbridge` stdio')
  .option('--host <host>', 'Bind host', '127.0.0.1')
  .option('--port <port>', 'Bind port', DEFAULT_PORT)
  .option('--path <path>', 'MCP endpoint path', '/mcp')
  .action(async (options: { host: string; port: string; path: string }) => {
    await startMcpBridge({
      host: options.host,
      port: Number(options.port),
      path: options.path,
    });
  });

program
  .command('agent-setup')
  .description('Configure Codex/Claude MCP to use the xcode-mcp HTTP bridge')
  .option('--client <client>', 'codex | claude | both', 'both')
  .option('--name <name>', 'MCP server name', 'xcode')
  .option('--url <url>', `Bridge MCP endpoint URL (default: ${DEFAULT_URL})`, DEFAULT_URL)
  .option('--scope <scope>', 'Claude scope: local | user | project', 'local')
  .option('--no-replace', 'Do not remove existing entries before adding')
  .action(
    async (options: {
      client: string;
      name: string;
      url: string;
      scope: string;
      replace: boolean;
    }) => {
      const client = parseClientTarget(options.client);
      if (client === 'codex' || client === 'both') {
        if (options.replace) {
          await runCommand('codex', ['mcp', 'remove', options.name], true);
        }
        await runCommand('codex', ['mcp', 'add', options.name, '--url', options.url]);
      }

      if (client === 'claude' || client === 'both') {
        if (options.replace) {
          await runCommand('claude', ['mcp', 'remove', '--scope', options.scope, options.name], true);
        }
        await runCommand('claude', [
          'mcp',
          'add',
          '--transport',
          'http',
          '--scope',
          options.scope,
          options.name,
          options.url,
        ]);
      }
    },
  );

program
  .command('status')
  .description('Quick status: windows + issues for current tab')
  .option('--severity <severity>', 'error | warning | remark', 'error')
  .action(async (options: { severity: string }) => {
    await withClient(async (ctx) => {
      const windows = await ctx.call('XcodeListWindows');
      const tabId = await resolveTabIdentifier(ctx, true, windows);
      const issues = await ctx.call('XcodeListNavigatorIssues', {
        tabIdentifier: tabId,
        severity: options.severity,
      });

      if (ctx.output === 'json') {
        console.log(
          JSON.stringify(
            {
              tabIdentifier: tabId,
              windows: unwrapResult(windows),
              issues: unwrapResult(issues),
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log(`tabIdentifier: ${tabId}`);
      console.log('');
      console.log('Windows');
      console.log('-------');
      printResult(windows, 'text');
      console.log('');
      console.log('Issues');
      console.log('------');
      printResult(issues, 'text');
    });
  });

program
  .command('issues')
  .description('List issues from Xcode Issue Navigator')
  .option('--glob <glob>', 'Filter issues by path glob')
  .option('--pattern <regex>', 'Filter issues by message regex')
  .option('--severity <severity>', 'error | warning | remark', 'error')
  .action(async (options: { glob?: string; pattern?: string; severity: string }) => {
    await withClient(async (ctx) => {
      const tabIdentifier = await resolveTabIdentifier(ctx, true);
      const result = await ctx.call('XcodeListNavigatorIssues', {
        tabIdentifier,
        severity: options.severity,
        glob: options.glob,
        pattern: options.pattern,
      });
      printResult(result, ctx.output);
    });
  });

program
  .command('file-issues <filePath>')
  .description('Refresh and list compiler diagnostics for a single file')
  .action(async (filePath: string) => {
    await withClient(async (ctx) => {
      const tabIdentifier = await resolveTabIdentifier(ctx, true);
      const result = await ctx.call('XcodeRefreshCodeIssuesInFile', {
        tabIdentifier,
        filePath,
      });
      printResult(result, ctx.output);
    });
  });

program
  .command('build')
  .description('Build current project in active scheme')
  .action(async () => {
    await withClient(async (ctx) => {
      const tabIdentifier = await resolveTabIdentifier(ctx, true);
      const result = await ctx.call('BuildProject', { tabIdentifier });
      printResult(result, ctx.output);
    });
  });

program
  .command('build-log')
  .description('Show current or most recent build log')
  .option('--glob <glob>', 'Filter log entries by file path glob')
  .option('--pattern <regex>', 'Filter log entries by message/console regex')
  .option('--severity <severity>', 'remark | warning | error', 'error')
  .action(async (options: { glob?: string; pattern?: string; severity: string }) => {
    await withClient(async (ctx) => {
      const tabIdentifier = await resolveTabIdentifier(ctx, true);
      const result = await ctx.call('GetBuildLog', {
        tabIdentifier,
        glob: options.glob,
        pattern: options.pattern,
        severity: options.severity,
      });
      printResult(result, ctx.output);
    });
  });

const tests = program.command('test').description('Run tests');

tests
  .command('all')
  .description('Run all tests from active test plan')
  .action(async () => {
    await withClient(async (ctx) => {
      const tabIdentifier = await resolveTabIdentifier(ctx, true);
      const result = await ctx.call('RunAllTests', { tabIdentifier });
      printResult(result, ctx.output);
    });
  });

tests
  .command('list')
  .description("List tests from the active scheme's active test plan")
  .action(async () => {
    await withClient(async (ctx) => {
      const tabIdentifier = await resolveTabIdentifier(ctx, true);
      const result = await ctx.call('GetTestList', { tabIdentifier });
      printResult(result, ctx.output);
    });
  });

tests
  .command('some <tests...>')
  .description('Run selected tests by identifiers (e.g. TargetName/testName())')
  .action(async (testsArg: string[]) => {
    await withClient(async (ctx) => {
      const tabIdentifier = await resolveTabIdentifier(ctx, true);
      const tests = testsArg.map(parseTestSpecifier);
      const result = await ctx.call('RunSomeTests', { tabIdentifier, tests });
      printResult(result, ctx.output);
    });
  });

program
  .command('ls [path]')
  .description('List files/groups in Xcode project structure')
  .option('-r, --recursive', 'List recursively')
  .action(async (targetPath: string | undefined, options: { recursive?: boolean }) => {
    await withClient(async (ctx) => {
      const tabIdentifier = await resolveTabIdentifier(ctx, true);
      const result = await ctx.call('XcodeLS', {
        tabIdentifier,
        path: targetPath ?? '/',
        recursive: Boolean(options.recursive),
      });
      if (options.recursive && ctx.output !== 'json') {
        const value = unwrapResult(result);
        const tree = renderLsTree(value, targetPath ?? '/');
        if (tree) {
          console.log(tree);
          return;
        }
      }
      printResult(result, ctx.output);
    });
  });

program
  .command('glob [pattern]')
  .description('Find files by glob pattern in project structure')
  .option('--path <path>', 'Base project path', '/')
  .action(async (pattern: string | undefined, options: { path: string }) => {
    await withClient(async (ctx) => {
      const tabIdentifier = await resolveTabIdentifier(ctx, true);
      const result = await ctx.call('XcodeGlob', {
        tabIdentifier,
        path: options.path,
        pattern: pattern ?? '**/*',
      });
      printResult(result, ctx.output);
    });
  });

program
  .command('read <filePath>')
  .description('Read a file from Xcode project structure')
  .option('--offset <offset>', 'Line offset', '0')
  .option('--limit <limit>', 'Max lines', '300')
  .action(async (filePath: string, options: { offset: string; limit: string }) => {
    await withClient(async (ctx) => {
      const tabIdentifier = await resolveTabIdentifier(ctx, true);
      const result = await ctx.call('XcodeRead', {
        tabIdentifier,
        filePath,
        offset: Number(options.offset),
        limit: Number(options.limit),
      });
      printResult(result, ctx.output);
    });
  });

program
  .command('grep <pattern>')
  .description('Regex search across files in Xcode project structure')
  .option('--glob <glob>', 'File glob filter')
  .option('--head-limit <n>', 'Limit matches', '100')
  .option('-i, --ignore-case', 'Case-insensitive pattern')
  .action(async (pattern: string, options: { glob?: string; headLimit: string; ignoreCase?: boolean }) => {
    await withClient(async (ctx) => {
      const tabIdentifier = await resolveTabIdentifier(ctx, true);
      const result = await ctx.call('XcodeGrep', {
        tabIdentifier,
        pattern,
        glob: options.glob,
        headLimit: Number(options.headLimit),
        ignoreCase: Boolean(options.ignoreCase),
      });
      printResult(result, ctx.output);
    });
  });

program
  .command('write <filePath> <content>')
  .description('Create/overwrite file content in Xcode project structure')
  .action(async (filePath: string, content: string) => {
    await withClient(async (ctx) => {
      const tabIdentifier = await resolveTabIdentifier(ctx, true);
      const result = await ctx.call('XcodeWrite', { tabIdentifier, filePath, content });
      printResult(result, ctx.output);
    });
  });

program
  .command('update <filePath> <oldString> <newString>')
  .description('Replace text in a file')
  .option('--replace-all', 'Replace all occurrences')
  .action(
    async (
      filePath: string,
      oldString: string,
      newString: string,
      options: { replaceAll?: boolean },
    ) => {
      await withClient(async (ctx) => {
        const tabIdentifier = await resolveTabIdentifier(ctx, true);
        const result = await ctx.call('XcodeUpdate', {
          tabIdentifier,
          filePath,
          oldString,
          newString,
          replaceAll: Boolean(options.replaceAll),
        });
        printResult(result, ctx.output);
      });
    },
  );

program
  .command('mkdir <directoryPath>')
  .description('Create directory/group in Xcode project structure')
  .action(async (directoryPath: string) => {
    await withClient(async (ctx) => {
      const tabIdentifier = await resolveTabIdentifier(ctx, true);
      const result = await ctx.call('XcodeMakeDir', { tabIdentifier, directoryPath });
      printResult(result, ctx.output);
    });
  });

program
  .command('rm <targetPath>')
  .description('Remove file/directory from project; optionally filesystem too')
  .option('-r, --recursive', 'Recursive removal')
  .option('--delete-files', 'Delete underlying files on disk')
  .action(async (targetPath: string, options: { recursive?: boolean; deleteFiles?: boolean }) => {
    await withClient(async (ctx) => {
      const tabIdentifier = await resolveTabIdentifier(ctx, true);
      const result = await ctx.call('XcodeRM', {
        tabIdentifier,
        path: targetPath,
        recursive: Boolean(options.recursive),
        deleteFiles: Boolean(options.deleteFiles),
      });
      printResult(result, ctx.output);
    });
  });

program
  .command('mv <sourcePath> <destinationPath>')
  .description('Move/rename/copy files in project structure')
  .option('--copy', 'Copy instead of move')
  .option('--overwrite', 'Overwrite destination if it exists')
  .action(
    async (
      sourcePath: string,
      destinationPath: string,
      options: { copy?: boolean; overwrite?: boolean },
    ) => {
      await withClient(async (ctx) => {
        const tabIdentifier = await resolveTabIdentifier(ctx, true);
        const result = await ctx.call('XcodeMV', {
          tabIdentifier,
          sourcePath,
          destinationPath,
          operation: options.copy ? 'copy' : 'move',
          overwriteExisting: Boolean(options.overwrite),
        });
        printResult(result, ctx.output);
      });
    },
  );

program
  .command('preview <sourceFilePath>')
  .description('Render SwiftUI preview for a file')
  .option('--index <n>', 'Preview definition index', '0')
  .option('--render-timeout <seconds>', 'Render timeout seconds', '120')
  .option('--out <path>', 'Write preview image to this path (or directory)')
  .action(
    async (
      sourceFilePath: string,
      options: { index: string; renderTimeout: string; out?: string },
    ) => {
    await withClient(async (ctx) => {
      const tabIdentifier = await resolveTabIdentifier(ctx, true);
      const result = await ctx.call('RenderPreview', {
        tabIdentifier,
        sourceFilePath,
        previewDefinitionIndexInFile: Number(options.index),
        timeout: Number(options.renderTimeout),
      });

      const raw = unwrapResult(result);
      const sourceImagePath = findPreviewPath(raw);
      if (!sourceImagePath) {
        throw new Error(
          `Preview rendered, but no output file path was found in response: ${JSON.stringify(raw)}`,
        );
      }

      const outputPath = options.out
        ? await copyPreviewToOutput(sourceImagePath, options.out)
        : sourceImagePath;
      console.log(outputPath);
    });
    },
  );

program
  .command('snippet <sourceFilePath> <codeSnippet>')
  .description('Execute a Swift snippet in the context of a source file')
  .option('--exec-timeout <seconds>', 'Snippet execution timeout seconds', '120')
  .action(
    async (
      sourceFilePath: string,
      codeSnippet: string,
      options: { execTimeout: string },
    ) => {
      await withClient(async (ctx) => {
        const tabIdentifier = await resolveTabIdentifier(ctx, true);
        const result = await ctx.call('ExecuteSnippet', {
          tabIdentifier,
          sourceFilePath,
          codeSnippet,
          timeout: Number(options.execTimeout),
        });
        printResult(result, ctx.output);
      });
    },
  );

program
  .command('doc <query>')
  .description('Search Apple docs via MCP docs search')
  .option('--frameworks <list>', 'Comma-separated frameworks')
  .action(async (query: string, options: { frameworks?: string }) => {
    await withClient(async (ctx) => {
      const frameworks = options.frameworks
        ? options.frameworks
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        : undefined;
      const result = await ctx.call('DocumentationSearch', { query, frameworks });
      printResult(result, ctx.output);
    });
  });

program
  .command('run <toolName>')
  .description('Run any MCP tool directly with JSON args')
  .requiredOption('--args <json>', 'JSON object with tool arguments')
  .action(async (toolName: string, options: { args: string }) => {
    await withClient(async (ctx) => {
      const parsed = JSON.parse(options.args) as Record<string, unknown>;
      const result = await ctx.call(toolName, parsed);
      printResult(result, ctx.output);
    });
  });

applyCommandOrder(program, [
  'status',
  'build',
  'build-log',
  'test',
  'issues',
  'file-issues',
  'windows',
  'read',
  'grep',
  'ls',
  'glob',
  'write',
  'update',
  'mv',
  'mkdir',
  'rm',
  'preview',
  'snippet',
  'doc',
  'agent-setup',
  'bridge',
  'tools',
  'run',
]);

program.parseAsync(process.argv).catch((error) => {
  const issue = describeConnectionIssue(error);
  if (issue.kind === 'http') {
    console.error(`HTTP error${issue.statusCode ? ` (${issue.statusCode})` : ''}: ${issue.rawMessage}`);
  } else if (issue.kind === 'timeout') {
    console.error(`Timeout: ${issue.rawMessage}`);
  } else if (issue.kind === 'auth') {
    console.error(`Auth error: ${issue.rawMessage}`);
  } else {
    console.error(issue.rawMessage || String(error));
  }
  process.exit(1);
});

async function withClient(handler: (ctx: ClientContext) => Promise<void>) {
  const root = program.opts<CommonOpts>();
  const endpoint = root.url ?? process.env.XCODE_MCP_URL ?? DEFAULT_URL;
  const timeoutMs = Number(root.timeout ?? '60000');
  const output = root.json ? 'json' : parseOutputFormat(root.output ?? 'text');

  const runtime = await createRuntime({
    servers: [
      {
        name: SERVER_NAME,
        description: 'xcode-tools',
        command: {
          kind: 'http',
          url: new URL(endpoint),
        },
      },
    ],
  });

  const proxy = createServerProxy(runtime, SERVER_NAME);
  const call = async (toolName: string, args?: Record<string, unknown>) =>
    proxy.call(toolName, { args, timeoutMs });

  try {
    await handler({
      proxy,
      output,
      timeoutMs,
      endpoint,
      tabOverride: root.tab ?? process.env.XCODE_TAB_ID,
      call,
    });
  } finally {
    await runtime.close().catch(() => undefined);
  }
}

async function resolveTabIdentifier(
  ctx: Pick<ClientContext, 'tabOverride' | 'call'>,
  autoDiscover: boolean,
  windowsResult?: CallResult,
): Promise<string> {
  if (ctx.tabOverride) {
    return ctx.tabOverride;
  }
  if (autoDiscover) {
    const windows = windowsResult ?? (await ctx.call('XcodeListWindows'));
    const discoveredTabIds = listTabIdentifiers(unwrapResult(windows));
    if (discoveredTabIds.length === 1) {
      return discoveredTabIds[0];
    }
  }
  throw new Error(
    'No tab identifier found. Use --tab <id> (or XCODE_TAB_ID) or run `xcode-mcp windows`.',
  );
}

function listTabIdentifiers(value: unknown): string[] {
  const tabIds = new Set<string>();
  const queue: unknown[] = [value];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    if (typeof current === 'string') {
      collectTabIdentifiersFromText(current, tabIds);
      continue;
    }

    if (typeof current !== 'object') {
      continue;
    }

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    const record = current as Record<string, unknown>;
    for (const [key, entry] of Object.entries(record)) {
      if (key === 'tabIdentifier' && typeof entry === 'string' && entry.trim()) {
        tabIds.add(entry.trim());
      }
      if (typeof entry === 'string') {
        collectTabIdentifiersFromText(entry, tabIds);
      }
      if (entry && typeof entry === 'object') {
        queue.push(entry);
      }
      if (Array.isArray(entry)) {
        queue.push(...entry);
      }
    }
  }
  return [...tabIds];
}

function collectTabIdentifiersFromText(text: string, sink: Set<string>) {
  const regex = /tabIdentifier:\s*([^\s,]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const tabIdentifier = match[1]?.trim();
    if (tabIdentifier) {
      sink.add(tabIdentifier);
    }
  }
}

function parseOutputFormat(value: string): CommonOpts['output'] {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'text' || normalized === 'json') {
    return normalized;
  }
  throw new Error(`Invalid output format '${value}'. Use 'text' or 'json'.`);
}

function parseClientTarget(value: string): 'codex' | 'claude' | 'both' {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'codex' || normalized === 'claude' || normalized === 'both') {
    return normalized;
  }
  throw new Error(`Invalid client '${value}'. Use 'codex', 'claude', or 'both'.`);
}

async function runCommand(command: string, args: string[], ignoreFailure = false): Promise<void> {
  console.error(`$ ${[command, ...args].join(' ')}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || ignoreFailure) {
        resolve();
        return;
      }
      reject(new Error(`Command failed: ${command} ${args.join(' ')} (exit ${code ?? 'unknown'})`));
    });
  });
}

function applyCommandOrder(root: Command, names: string[]): void {
  const weights = new Map<string, number>(names.map((name, index) => [name, index]));
  root.commands.sort((a, b) => {
    const aWeight = weights.get(a.name()) ?? Number.MAX_SAFE_INTEGER;
    const bWeight = weights.get(b.name()) ?? Number.MAX_SAFE_INTEGER;
    if (aWeight !== bWeight) {
      return aWeight - bWeight;
    }
    return a.name().localeCompare(b.name());
  });
}
