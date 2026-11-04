import path from 'node:path';
import type { CleanResult, ScanResult } from '../types.js';
import { clearDir, getSize, isDirectory, listDir } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

export class TrashScanner extends BaseScanner {
  readonly name = 'Trash';
  readonly category = 'trash';
  readonly description = 'Files in ~/.Trash';
  readonly risk = 'moderate' as const;

  async scan(): Promise<ScanResult[]> {
    const trash = path.join(HOME, '.Trash');
    if (!(await isDirectory(trash))) return [];
    let total = 0;
    for (const name of await listDir(trash)) {
      total += await getSize(path.join(trash, name));
    }
    if (total === 0) return [];
    return [
      {
        path: trash,
        size: total,
        label: 'Files in Trash',
        category: this.category,
        risk: this.risk,
        description: 'Empties ~/.Trash contents (keeps the dir itself)',
      },
    ];
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
