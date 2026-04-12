import path from 'node:path';
import type { ScanResult } from '../types.js';
import { getSize, isDirectory, listDir } from '../utils/fs.js';
import { BaseScanner } from './base-scanner.js';

export class SystemCacheScanner extends BaseScanner {
  readonly name = 'System Caches';
  readonly category = 'system-cache';
  readonly description = '/Library/Caches entries (requires sudo to fully clean)';
  readonly risk = 'moderate' as const;

  async scan(): Promise<ScanResult[]> {
    const root = '/Library/Caches';
    if (!(await isDirectory(root))) return [];
    const results: ScanResult[] = [];
    for (const name of await listDir(root)) {
      if (name.startsWith('.')) continue;
      const target = path.join(root, name);
      if (!(await isDirectory(target))) continue;
      const size = await getSize(target);
      if (size < 50 * 1024 * 1024) continue;
      results.push({
        path: target,
        size,
        label: name,
        category: this.category,
        risk: this.risk,
        description: `/Library/Caches/${name}`,
      });
    }
    return results.sort((a, b) => b.size - a.size);
  }
}
