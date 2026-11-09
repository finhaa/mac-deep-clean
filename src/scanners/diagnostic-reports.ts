import path from 'node:path';
import type { CleanResult, ScanResult } from '../types.js';
import { canWriteDir, clearDir, getSize, pathExists } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

export class DiagnosticReportsScanner extends BaseScanner {
  readonly name = 'Diagnostic Reports';
  readonly category = 'diagnostic-reports';
  readonly description = 'Crash reports and diagnostic logs';
  readonly risk = 'safe' as const;

  targets: Array<{ path: string; label: string }> = [
    {
      path: path.join(HOME, 'Library/Logs/DiagnosticReports'),
      label: 'User DiagnosticReports',
    },
    { path: '/Library/Logs/DiagnosticReports', label: 'System DiagnosticReports' },
  ];

  async scan(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    for (const t of this.targets) {
      if (!(await pathExists(t.path)) || !(await canWriteDir(t.path))) continue;
      const size = await getSize(t.path);
      if (size === 0) continue;
      results.push({
        path: t.path,
        size,
        label: t.label,
        category: this.category,
        risk: this.risk,
        description: 'Crash reports, hang reports, spindumps',
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
      const cleared = await clearDir(r.path);
      freed += cleared.freed;
      errors.push(...cleared.errors);
    }
    return { freed, errors };
  }
}
