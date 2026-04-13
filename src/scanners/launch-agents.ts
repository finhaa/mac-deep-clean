import fs from 'node:fs/promises';
import path from 'node:path';
import type { ScanResult } from '../types.js';
import { run } from '../utils/exec.js';
import { isDirectory, listDir, pathExists } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

export class LaunchAgentsScanner extends BaseScanner {
  readonly name = 'Orphaned LaunchAgents';
  readonly category = 'launch-agents';
  readonly description = 'LaunchAgent plists whose target binary no longer exists';
  readonly risk = 'moderate' as const;

  async scan(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    const roots = [
      path.join(HOME, 'Library/LaunchAgents'),
      '/Library/LaunchAgents',
      '/Library/LaunchDaemons',
    ];

    for (const root of roots) {
      if (!(await isDirectory(root))) continue;
      for (const name of await listDir(root)) {
        if (!name.endsWith('.plist')) continue;
        const plistPath = path.join(root, name);
        const program = await readPlistProgram(plistPath);
        if (!program) continue;
        if (await pathExists(program)) continue;
        const stat = await fs.lstat(plistPath).catch(() => null);
        const size = stat?.size ?? 0;
        results.push({
          path: plistPath,
          size,
          label: `${name} → ${program}`,
          category: this.category,
          risk: this.risk,
          description: `LaunchAgent whose target binary ${program} is missing`,
        });
      }
    }
    return results;
  }
}

async function readPlistProgram(plistPath: string): Promise<string | null> {
  const escaped = plistPath.replace(/(["\\$`])/g, '\\$1');
  const { stdout, code } = await run(`plutil -convert json -o - "${escaped}" 2>/dev/null`, {
    timeout: 5000,
  });
  if (code !== 0 || !stdout.trim()) return null;
  try {
    const data = JSON.parse(stdout) as {
      Program?: string;
      ProgramArguments?: string[];
    };
    if (typeof data.Program === 'string') return data.Program;
    if (Array.isArray(data.ProgramArguments) && data.ProgramArguments.length > 0) {
      const first = data.ProgramArguments[0];
      if (typeof first === 'string') return first;
    }
  } catch {
    return null;
  }
  return null;
}
