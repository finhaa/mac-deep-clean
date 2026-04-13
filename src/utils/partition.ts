import type { ScannerReport, ScanResult } from '../types.js';

export interface PartitionedReports {
  reports: ScannerReport[];
  infoItems: ScanResult[];
}

/**
 * Split each scanner report into a cleanable part and an "info only" part.
 * Items flagged `cleanable: false` are collected separately so the CLI can
 * render them without including them in selection prompts or totals.
 */
export function partitionCleanable(reports: ScannerReport[]): PartitionedReports {
  const infoItems: ScanResult[] = [];
  const partitioned: ScannerReport[] = reports.map((r) => {
    const cleanable: ScanResult[] = [];
    for (const item of r.results) {
      if (item.cleanable === false) {
        infoItems.push(item);
      } else {
        cleanable.push(item);
      }
    }
    return {
      ...r,
      results: cleanable,
      totalSize: cleanable.reduce((s, i) => s + i.size, 0),
    };
  });
  return { reports: partitioned, infoItems };
}
