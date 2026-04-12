import path from 'node:path';
import type { ScanResult } from '../types.js';
import { getSize, pathExists } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

export class LogsScanner extends BaseScanner {
  readonly name = 'Logs';
  readonly category = 'logs';
  readonly description = 'User and system log directories';
  readonly risk = 'safe' as const;

  async scan(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    const targets: Array<{ path: string; label: string }> = [
      { path: path.join(HOME, 'Library/Logs'), label: 'User logs' },
      { path: '/Library/Logs', label: 'System logs' },
    ];
    for (const t of targets) {
      if (!(await pathExists(t.path))) continue;
      const size = await getSize(t.path);
      if (size < 10 * 1024 * 1024) continue;
      results.push({
        path: t.path,
        size,
        label: t.label,
        category: this.category,
        risk: this.risk,
        description: t.label,
      });
    }
    return results;
  }
}
