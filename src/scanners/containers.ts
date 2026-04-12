import path from 'node:path';
import type { ScanResult } from '../types.js';
import { getSize, isDirectory, listDir } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';
import { WallpaperCacheScanner } from './wallpaper-cache.js';

const SKIPPED_BUNDLE_IDS = new Set<string>(WallpaperCacheScanner.skippedContainerBundleIds);

export class ContainersScanner extends BaseScanner {
  readonly name = 'Containers';
  readonly category = 'containers';
  readonly description = '~/Library/Containers and Group Containers cache dirs';
  readonly risk = 'moderate' as const;

  async scan(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    const containersRoot = path.join(HOME, 'Library/Containers');
    const groupContainersRoot = path.join(HOME, 'Library/Group Containers');

    for (const bundleId of await listDir(containersRoot)) {
      if (bundleId.startsWith('.')) continue;
      if (SKIPPED_BUNDLE_IDS.has(bundleId)) continue;
      const cacheDir = path.join(containersRoot, bundleId, 'Data/Library/Caches');
      if (!(await isDirectory(cacheDir))) continue;
      const size = await getSize(cacheDir);
      if (size < 10 * 1024 * 1024) continue;
      results.push({
        path: cacheDir,
        size,
        label: `Container: ${bundleId}`,
        category: this.category,
        risk: this.risk,
        description: `Cache for ${bundleId}`,
      });
    }

    for (const groupId of await listDir(groupContainersRoot)) {
      if (groupId.startsWith('.')) continue;
      const cacheDir = path.join(groupContainersRoot, groupId, 'Library/Caches');
      if (!(await isDirectory(cacheDir))) continue;
      const size = await getSize(cacheDir);
      if (size < 10 * 1024 * 1024) continue;
      results.push({
        path: cacheDir,
        size,
        label: `Group Container: ${groupId}`,
        category: this.category,
        risk: this.risk,
        description: `Group cache for ${groupId}`,
      });
    }

    return results.sort((a, b) => b.size - a.size);
  }
}
