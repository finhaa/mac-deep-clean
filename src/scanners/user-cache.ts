import path from 'node:path';
import type { ScanResult } from '../types.js';
import { getSize, isDirectory, listDir } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

const COVERED_PREFIXES = [
  'Google/AndroidStudio',
  'Homebrew',
  'pip',
  'pypoetry',
  'uv',
  'deno',
  'Yarn',
];

export class UserCacheScanner extends BaseScanner {
  readonly name = 'User Caches';
  readonly category = 'user-cache';
  readonly description = 'Generic ~/Library/Caches entries not covered by other scanners';
  readonly risk = 'safe' as const;

  async scan(): Promise<ScanResult[]> {
    const root = path.join(HOME, 'Library/Caches');
    if (!(await isDirectory(root))) return [];
    const results: ScanResult[] = [];
    for (const name of await listDir(root)) {
      if (name.startsWith('.')) continue;
      if (COVERED_PREFIXES.some((p) => name.startsWith(p))) continue;
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
        description: `~/Library/Caches/${name}`,
      });
    }
    return results.sort((a, b) => b.size - a.size);
  }
}
