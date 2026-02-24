import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CliConfig } from './xcode-types.ts';

const CONFIG_PATH = path.resolve(process.cwd(), '.xcode-cli.json');

export async function readConfig(): Promise<CliConfig> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as CliConfig;
    return {
      endpoint: parsed.endpoint,
      defaultTabId: parsed.defaultTabId,
    };
  } catch {
    return {};
  }
}

export async function writeConfig(config: CliConfig): Promise<void> {
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}
