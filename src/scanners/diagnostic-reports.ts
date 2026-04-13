import path from 'node:path';
import type { ScanResult } from '../types.js';
import { getSize, pathExists } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

export class DiagnosticReportsScanner extends BaseScanner {
  readonly name = 'Diagnostic Reports';
  readonly category = 'diagnostic-reports';
  readonly description = 'Crash reports and diagnostic logs';
  readonly risk = 'safe' as const;

  async scan(): Promise<ScanResult[]> {
    const targets: Array<{ path: string; label: string }> = [
      {
        path: path.join(HOME, 'Library/Logs/DiagnosticReports'),
        label: 'User DiagnosticReports',
      },
      { path: '/Library/Logs/DiagnosticReports', label: 'System DiagnosticReports' },
    ];
    const results: ScanResult[] = [];
    for (const t of targets) {
      if (!(await pathExists(t.path))) continue;
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
}
