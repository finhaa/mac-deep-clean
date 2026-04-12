import path from 'node:path';
import type { ScanResult } from '../types.js';
import { getSize, pathExists } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

const BROWSERS: Array<{ name: string; paths: string[] }> = [
  {
    name: 'Arc',
    paths: [
      'Library/Application Support/Arc/User Data/Default/Cache',
      'Library/Application Support/Arc/User Data/Default/Code Cache',
      'Library/Application Support/Arc/User Data/Default/GPUCache',
      'Library/Caches/Arc',
    ],
  },
  {
    name: 'Chrome',
    paths: [
      'Library/Application Support/Google/Chrome/Default/Cache',
      'Library/Application Support/Google/Chrome/Default/Code Cache',
      'Library/Application Support/Google/Chrome/Default/GPUCache',
      'Library/Caches/Google/Chrome',
    ],
  },
  {
    name: 'Safari',
    paths: ['Library/Caches/com.apple.Safari'],
  },
  {
    name: 'Firefox',
    paths: ['Library/Caches/Firefox'],
  },
  {
    name: 'Brave',
    paths: [
      'Library/Application Support/BraveSoftware/Brave-Browser/Default/Cache',
      'Library/Caches/BraveSoftware',
    ],
  },
  {
    name: 'Edge',
    paths: [
      'Library/Application Support/Microsoft Edge/Default/Cache',
      'Library/Caches/Microsoft Edge',
    ],
  },
];

export class BrowserCacheScanner extends BaseScanner {
  readonly name = 'Browser Caches';
  readonly category = 'browser-cache';
  readonly description = 'Arc, Chrome, Safari, Firefox, Brave, Edge caches';
  readonly risk = 'safe' as const;

  async scan(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    for (const b of BROWSERS) {
      for (const rel of b.paths) {
        const target = path.join(HOME, rel);
        if (!(await pathExists(target))) continue;
        const size = await getSize(target);
        if (size < 1024 * 1024) continue;
        results.push({
          path: target,
          size,
          label: `${b.name} cache`,
          category: this.category,
          risk: this.risk,
          description: `${b.name}: ${path.basename(rel)}`,
        });
      }
    }
    return results;
  }
}
