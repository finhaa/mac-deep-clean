import type { ScanResult, ScannerReport } from '../types.js';

export function autoSelect(reports: ScannerReport[], includeAllRisks: boolean): ScanResult[] {
  return reports
    .flatMap((r) => r.results)
    .filter((item) => includeAllRisks || item.risk === 'safe');
}
