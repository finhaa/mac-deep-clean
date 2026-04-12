import type { CleanResult, Risk, ScanOptions, ScanResult } from '../types.js';
import { safeRemove } from '../utils/fs.js';

export abstract class BaseScanner {
  abstract readonly name: string;
  abstract readonly category: string;
  abstract readonly description: string;
  abstract readonly risk: Risk;

  abstract scan(options?: ScanOptions): Promise<ScanResult[]>;

  async clean(results: ScanResult[], dryRun = false): Promise<CleanResult> {
    let freed = 0;
    const errors: string[] = [];
    for (const r of results) {
      try {
        if (!dryRun) await safeRemove(r.path);
        freed += r.size;
      } catch (err) {
        errors.push(`${r.path}: ${(err as Error).message}`);
      }
    }
    return { freed, errors };
  }
}
