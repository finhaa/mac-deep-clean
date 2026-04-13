import path from 'node:path';
import type { CleanResult, ScanResult } from '../types.js';
import { clearDir, getSize, isDirectory, listDir } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

export class TrashScanner extends BaseScanner {
  readonly name = 'Trash';
  readonly category = 'trash';
  readonly description = 'Files in ~/.Trash';
  readonly risk = 'safe' as const;

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
      try {
        if (!dryRun) await clearDir(r.path);
        freed += r.size;
      } catch (err) {
        errors.push(`${r.path}: ${(err as Error).message}`);
      }
    }
    return { freed, errors };
  }
}
