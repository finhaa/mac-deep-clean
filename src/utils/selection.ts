import { isCheckedByDefault } from '../scanners/project-artifacts.js';
import type { ScanResult, ScannerReport } from '../types.js';

export function autoSelect(reports: ScannerReport[], includeAllRisks: boolean): ScanResult[] {
  return reports
    .flatMap((r) => r.results)
    .filter((item) => includeAllRisks || item.risk === 'safe')
    .filter((item) => item.category !== 'project-artifacts' || isCheckedByDefault(item.path));
}
