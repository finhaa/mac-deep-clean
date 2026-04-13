import path from 'node:path';
import type { ScanResult } from '../types.js';
import { getSize, isDirectory, listDir } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

export class IosBackupsScanner extends BaseScanner {
  readonly name = 'iOS Device Backups';
  readonly category = 'ios-backups';
  readonly description = '~/Library/Application Support/MobileSync/Backup';
  readonly risk = 'moderate' as const;

  async scan(): Promise<ScanResult[]> {
    const root = path.join(HOME, 'Library/Application Support/MobileSync/Backup');
    if (!(await isDirectory(root))) return [];
    const results: ScanResult[] = [];
    for (const uuid of await listDir(root)) {
      if (uuid.startsWith('.')) continue;
      const target = path.join(root, uuid);
      if (!(await isDirectory(target))) continue;
      const size = await getSize(target);
      if (size < 10 * 1024 * 1024) continue;
      results.push({
        path: target,
        size,
        label: `iOS backup ${uuid.slice(0, 16)}…`,
        category: this.category,
        risk: this.risk,
        description: 'iOS/iPadOS device backup — deletion is permanent',
      });
    }
    return results.sort((a, b) => b.size - a.size);
  }
}
