import { isCheckedByDefault } from '../scanners/project-artifacts.js';
import type { ScanResult, ScannerReport } from '../types.js';

// Deletes that cannot be undone, or that run under sudo: `--yes` never picks them from a broad `--risky`,
// only when the caller names the category.
const NEEDS_EXPLICIT_CATEGORY = new Set([
  'ios-backups',
  'screen-recording',
  'music-creation',
  'time-machine',
  'apfs-snapshots',
]);

export function autoSelect(
  reports: ScannerReport[],
  includeAllRisks: boolean,
  explicitCategory = false,
): ScanResult[] {
  return reports
    .flatMap((r) => r.results)
    .filter((item) => includeAllRisks || item.risk === 'safe')
    .filter((item) => explicitCategory || !NEEDS_EXPLICIT_CATEGORY.has(item.category))
    .filter((item) => item.category !== 'project-artifacts' || isCheckedByDefault(item.path));
}
