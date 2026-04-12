import path from 'node:path';
import type { ScanResult } from '../types.js';
import { getSize, pathExists } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

export class WallpaperCacheScanner extends BaseScanner {
  readonly name = 'Wallpaper Cache';
  readonly category = 'wallpaper';
  readonly description = 'com.apple.wallpaper cache (regenerates on wallpaper change)';
  readonly risk = 'safe' as const;

  async scan(): Promise<ScanResult[]> {
    const target = path.join(HOME, 'Library/Application Support/com.apple.wallpaper/Store');
    if (!(await pathExists(target))) return [];
    const size = await getSize(target);
    if (size === 0) return [];
    return [
      {
        path: target,
        size,
        label: 'com.apple.wallpaper/Store',
        category: this.category,
        risk: this.risk,
        description: 'Wallpaper cache — regenerates automatically',
      },
    ];
  }
}
