import type { CallResult } from 'mcporter';
import type { CommonOpts } from './xcode-types.ts';

export function unwrapResult(result: CallResult): unknown {
  const structured = result.structuredContent();
  if (structured !== undefined && structured !== null) {
    return structured;
  }
  const json = result.json();
  if (json !== null) {
    return json;
  }
  return result.raw;
}

export function printResult(result: CallResult, output: CommonOpts['output']) {
  const value = unwrapResult(result);
  if (output === 'json') {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(formatReadableOutput(value));
}

function formatReadableOutput(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '(no items)';
    }
    return value.map((item) => `- ${formatListItem(item)}`).join('\n');
  }
  if (typeof value !== 'object') {
    return String(value);
  }

  const record = value as Record<string, unknown>;

  if (isTestRunPayload(record)) {
    return formatTestRunOutput(record);
  }

  if (record.type === 'error' && typeof record.data === 'string') {
    return `Error: ${record.data}`;
  }

  if (typeof record.previewSnapshotPath === 'string') {
    return record.previewSnapshotPath;
  }
  if (typeof record.executionResults === 'string') {
    return record.executionResults.trimEnd();
  }
  if (typeof record.buildResult === 'string') {
    const errors = Array.isArray(record.errors) ? record.errors : [];
    if (errors.length === 0) {
      return record.buildResult;
    }
    return `${record.buildResult}\nErrors:\n${errors.map((entry) => `- ${formatListItem(entry)}`).join('\n')}`;
  }
  if (typeof record.content === 'string' && typeof record.filePath === 'string') {
    const header = `${record.filePath}`;
    const sep = '-'.repeat(header.length);
    return `${header}\n${sep}\n${record.content}`;
  }

  if (Array.isArray(record.issues)) {
    return formatNamedList('Issues', record.issues);
  }
  if (Array.isArray(record.documents)) {
    return formatNamedList('Documents', record.documents);
  }
  if (Array.isArray(record.tests)) {
    return formatNamedList('Tests', record.tests);
  }
  if (Array.isArray(record.items)) {
    return formatNamedList('Items', record.items);
  }
  if (Array.isArray(record.matches)) {
    return formatNamedList('Matches', record.matches);
  }
  if (Array.isArray(record.results)) {
    return formatNamedList('Results', record.results);
  }

  return formatObject(record);
}

function isTestRunPayload(record: Record<string, unknown>): boolean {
  return Boolean(
    record &&
      typeof record.summary === 'string' &&
      Array.isArray(record.results) &&
      record.counts &&
      typeof record.counts === 'object',
  );
}

function formatTestRunOutput(record: Record<string, unknown>): string {
  const lines: string[] = [];
  const summary = typeof record.summary === 'string' ? record.summary : undefined;
  const schemeName = typeof record.schemeName === 'string' ? record.schemeName : undefined;
  const activeTestPlanName =
    typeof record.activeTestPlanName === 'string' ? record.activeTestPlanName : undefined;
  const fullSummaryPath =
    typeof record.fullSummaryPath === 'string' ? record.fullSummaryPath : undefined;
  const truncated = record.truncated === true;

  if (summary) {
    lines.push(summary);
  }
  if (schemeName) {
    lines.push(`scheme: ${schemeName}`);
  }
  if (activeTestPlanName) {
    lines.push(`test plan: ${activeTestPlanName}`);
  }
  if (fullSummaryPath) {
    lines.push(`full summary: ${fullSummaryPath}`);
  }

  const counts = record.counts as Record<string, unknown>;
  lines.push(
    `counts: total=${toInt(counts.total)} passed=${toInt(counts.passed)} failed=${toInt(counts.failed)} skipped=${toInt(counts.skipped)} expectedFailures=${toInt(counts.expectedFailures)} notRun=${toInt(counts.notRun)}`,
  );

  const results = (Array.isArray(record.results) ? record.results : []).filter(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object',
  );

  if (results.length === 0) {
    return lines.join('\n');
  }

  lines.push('');
  lines.push(`results (${results.length}):`);
  for (const entry of results) {
    const identifier = typeof entry.identifier === 'string' ? entry.identifier : undefined;
    const displayName = typeof entry.displayName === 'string' ? entry.displayName : undefined;
    const targetName = typeof entry.targetName === 'string' ? entry.targetName : undefined;
    const state = typeof entry.state === 'string' ? entry.state : 'Unknown';
    const label = identifier ?? displayName ?? '<unknown test>';

    lines.push(`- [${state}] ${label}`);
    if (targetName) {
      lines.push(`  target: ${targetName}`);
    }

    const errorMessages = Array.isArray(entry.errorMessages)
      ? entry.errorMessages.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];

    if (errorMessages.length > 0) {
      lines.push('  errors:');
      for (const message of errorMessages) {
        lines.push(`    - ${message}`);
      }
    }
  }

  if (truncated) {
    lines.push('');
    lines.push('note: results were truncated by MCP');
  }

  return lines.join('\n');
}

function toInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return 0;
}

function formatNamedList(title: string, items: unknown[]): string {
  if (items.length === 0) {
    return `${title}: none`;
  }
  return `${title} (${items.length})\n${items.map((item) => `- ${formatListItem(item)}`).join('\n')}`;
}

function formatListItem(item: unknown): string {
  if (item === null || item === undefined) {
    return '';
  }
  if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
    return String(item);
  }
  if (Array.isArray(item)) {
    return item.map((entry) => formatListItem(entry)).join(', ');
  }
  if (typeof item !== 'object') {
    return String(item);
  }

  const record = item as Record<string, unknown>;
  const pathValue = firstString(record, ['path', 'filePath', 'file', 'uri']);
  const titleValue = firstString(record, ['title', 'displayName', 'identifier', 'name']);
  const messageValue = firstString(record, ['message', 'contents', 'summary']);
  const severity = firstString(record, ['severity', 'type']);
  const line = firstNumber(record, ['line', 'lineNumber']);
  const score = firstNumber(record, ['score']);

  const parts: string[] = [];
  if (severity) {
    parts.push(`[${severity}]`);
  }
  if (titleValue) {
    parts.push(titleValue);
  }
  if (pathValue) {
    parts.push(line ? `${pathValue}:${line}` : pathValue);
  }
  if (typeof score === 'number') {
    parts.push(`score=${score.toFixed(3)}`);
  }
  if (messageValue && !titleValue) {
    parts.push(messageValue);
  }

  if (parts.length > 0) {
    return parts.join(' ');
  }
  return formatObject(record).replace(/\n/g, '; ');
}

function formatObject(record: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${formatListItem(item)}`);
        }
      }
      continue;
    }
    if (value && typeof value === 'object') {
      lines.push(`${key}:`);
      const nested = formatObject(value as Record<string, unknown>)
        .split('\n')
        .map((line) => `  ${line}`);
      lines.push(...nested);
      continue;
    }
    lines.push(`${key}: ${String(value)}`);
  }
  return lines.join('\n');
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}
