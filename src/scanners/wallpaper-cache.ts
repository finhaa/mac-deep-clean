import path from 'node:path';
import type { ScanResult } from '../types.js';
import { getSize, pathExists } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

const WALLPAPER_BUNDLE_IDS = ['com.apple.wallpaper.agent', 'com.apple.wallpaper'];

const WALLPAPER_PATHS: Array<{ path: string; label: string }> = [
  {
    path: path.join(HOME, 'Library/Application Support/com.apple.wallpaper'),
    label: 'Application Support/com.apple.wallpaper',
  },
  ...WALLPAPER_BUNDLE_IDS.map((id) => ({
    path: path.join(HOME, 'Library/Containers', id, 'Data/Library/Caches'),
    label: `Containers/${id}/Caches`,
  })),
];

export class WallpaperCacheScanner extends BaseScanner {
  readonly name = 'Wallpaper Cache';
  readonly category = 'wallpaper';
  readonly description = 'com.apple.wallpaper cache (regenerates on wallpaper change)';
  readonly risk = 'safe' as const;

  static readonly skippedContainerBundleIds: readonly string[] = WALLPAPER_BUNDLE_IDS;

  async scan(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    for (const target of WALLPAPER_PATHS) {
      if (!(await pathExists(target.path))) continue;
      const size = await getSize(target.path);
      if (size === 0) continue;
      results.push({
        path: target.path,
        size,
        label: target.label,
        category: this.category,
        risk: this.risk,
        description: 'Wallpaper cache — regenerates automatically',
      });
    }
    return results.sort((a, b) => b.size - a.size);
  }
}
