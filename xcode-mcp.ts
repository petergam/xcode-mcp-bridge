import http from 'node:http';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  isInitializeRequest,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readConfig, writeConfig } from './xcode-config.ts';

export type McpBridgeStartOptions = {
  host: string;
  port: number;
  path: string;
  saveEndpoint: boolean;
};

type TransportSession = {
  server: Server;
  transport: StreamableHTTPServerTransport;
};

const BRIDGE_NAME = 'xcode-mcp-http-bridge';
const BRIDGE_VERSION = '1.0.0';

export async function startMcpBridge(options: McpBridgeStartOptions): Promise<void> {
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error(`Invalid port '${options.port}'. Use an integer between 1 and 65535.`);
  }

  const endpoint = new URL(`http://${options.host}:${options.port}${normalizePath(options.path)}`);
  const upstream = new Client(
    {
      name: BRIDGE_NAME,
      version: BRIDGE_VERSION,
    },
    {
      capabilities: {},
    },
  );
  const upstreamTransport = new StdioClientTransport({
    command: 'xcrun',
    args: ['mcpbridge'],
    env: buildEnv(),
    stderr: 'inherit',
  });

  upstream.onerror = (error) => {
    console.error(`Upstream stdio MCP error: ${error.message}`);
  };

  await upstream.connect(upstreamTransport);

  if (options.saveEndpoint) {
    const config = await readConfig();
    config.endpoint = endpoint.toString();
    await writeConfig(config);
  }

  const sessions = new Map<string, TransportSession>();
  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        res.statusCode = 400;
        res.end('Missing URL');
        return;
      }

      const requestUrl = new URL(req.url, endpoint);
      if (requestUrl.pathname === '/health') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, endpoint: endpoint.toString() }));
        return;
      }

      if (requestUrl.pathname !== normalizePath(options.path)) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }

      const method = req.method?.toUpperCase() ?? '';
      const body = method === 'POST' ? await parseJsonBody(req) : undefined;
      const sessionIdHeader = req.headers['mcp-session-id'];
      const sessionId =
        typeof sessionIdHeader === 'string'
          ? sessionIdHeader
          : Array.isArray(sessionIdHeader)
            ? sessionIdHeader[0]
            : undefined;

      if (method === 'POST') {
        if (sessionId && sessions.has(sessionId)) {
          await sessions.get(sessionId)!.transport.handleRequest(req, res, body);
          return;
        }

        if (!sessionId && isInitializeRequest(body)) {
          let mcpServer: Server;
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (newSessionId) => {
              sessions.set(newSessionId, { server: mcpServer, transport });
            },
          });
          transport.onclose = () => {
            const closedSessionId = transport.sessionId;
            if (!closedSessionId) {
              return;
            }
            const closed = sessions.get(closedSessionId);
            if (closed) {
              closed.server.close().catch(() => undefined);
              sessions.delete(closedSessionId);
            }
          };

          mcpServer = createSessionServer(upstream);
          await mcpServer.connect(transport);
          await transport.handleRequest(req, res, body);
          return;
        }

        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: missing valid MCP session' },
            id: null,
          }),
        );
        return;
      }

      if (method === 'GET' || method === 'DELETE') {
        if (!sessionId || !sessions.has(sessionId)) {
          res.statusCode = 400;
          res.end('Invalid or missing MCP session ID');
          return;
        }
        await sessions.get(sessionId)!.transport.handleRequest(req, res);
        return;
      }

      res.statusCode = 405;
      res.end('Method not allowed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message },
            id: null,
          }),
        );
      }
    }
  });

  const cleanup = async () => {
    for (const { server: sessionServer, transport } of sessions.values()) {
      await transport.close().catch(() => undefined);
      await sessionServer.close().catch(() => undefined);
    }
    sessions.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await upstream.close().catch(() => undefined);
    await upstreamTransport.close().catch(() => undefined);
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      cleanup()
        .catch(() => undefined)
        .finally(() => {
          process.exit(0);
        });
    });
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      const saveSuffix = options.saveEndpoint ? ' (saved as default endpoint)' : '';
      console.error(`MCP bridge listening on ${endpoint.toString()}${saveSuffix}`);
      console.error('Upstream stdio: xcrun mcpbridge');
      resolve();
    });
  });
}

function createSessionServer(upstream: Client): Server {
  const server = new Server(
    {
      name: BRIDGE_NAME,
      version: BRIDGE_VERSION,
    },
    {
      capabilities: {
        tools: {
          listChanged: true,
        },
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    return await upstream.listTools(request.params);
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return await upstream.callTool(request.params);
  });

  return server;
}

function normalizePath(value: string): string {
  if (!value.startsWith('/')) {
    return `/${value}`;
  }
  return value;
}

function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }
  return env;
}

async function parseJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return undefined;
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return undefined;
  }
  return JSON.parse(raw);
}
