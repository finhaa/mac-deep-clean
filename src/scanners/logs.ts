import path from 'node:path';
import type { CleanResult, ScanResult } from '../types.js';
import { clearDir, isDirectory, sizeExcluding } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

// Folders under a Logs directory that another scanner reports on its own.
export const OWNED_BY_OTHER_SCANNERS = ['DiagnosticReports', 'JetBrains'];

export class LogsScanner extends BaseScanner {
  readonly name = 'Logs';
  readonly category = 'logs';
  readonly description = 'User and system log directories';
  readonly risk = 'safe' as const;

  targets: Array<{ path: string; label: string }> = [
    { path: path.join(HOME, 'Library/Logs'), label: 'User logs' },
    { path: '/Library/Logs', label: 'System logs' },
  ];

  async scan(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    for (const t of this.targets) {
      if (!(await isDirectory(t.path))) continue;
      const size = await sizeExcluding(t.path, OWNED_BY_OTHER_SCANNERS);
      if (size < 10 * 1024 * 1024) continue;
      results.push({
        path: t.path,
        size,
        label: t.label,
        category: this.category,
        risk: this.risk,
        description: `${t.label}, without Diagnostic Reports and JetBrains logs (own categories)`,
      });
    }
    return results;
  }

  override async clean(results: ScanResult[], dryRun = false): Promise<CleanResult> {
    let freed = 0;
    const errors: string[] = [];
    for (const r of results) {
      if (dryRun) {
        freed += r.size;
        continue;
      }
      const cleared = await clearDir(r.path, OWNED_BY_OTHER_SCANNERS);
      freed += cleared.freed;
      errors.push(...cleared.errors);
    }
    return { freed, errors };
  }
}
