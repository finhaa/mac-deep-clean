import path from 'node:path';
import type { ScanResult } from '../types.js';
import { getSize, isDirectory, listDir } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

const COVERED_ELSEWHERE = new Set([
  'Google',
  'Arc',
  'com.apple.Safari',
  'Firefox',
  'BraveSoftware',
  'Microsoft Edge',
  'JetBrains',
  'Homebrew',
  'pip',
  'pypoetry',
  'uv',
  'deno',
  'Yarn',
  'CocoaPods',
  'pre-commit',
  'Composer',
  'Bazel',
  'go-build',
  // Downloaded browser binaries, not a cache: deleting forces a reinstall.
  'ms-playwright',
  'ms-playwright-mcp',
]);

export function isCoveredElsewhere(name: string): boolean {
  return COVERED_ELSEWHERE.has(name);
}

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
      if (isCoveredElsewhere(name)) continue;
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
