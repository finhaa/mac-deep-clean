import path from 'node:path';
import type { ScanResult } from '../types.js';
import { getSize, isDirectory, listDir, pathExists } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

export class AndroidScanner extends BaseScanner {
  readonly name = 'Android SDK';
  readonly category = 'android';
  readonly description = 'Android SDK, AVDs, emulators, Android Studio caches';
  readonly risk = 'moderate' as const;

  async scan(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];

    const sdk = path.join(HOME, 'Library/Android/sdk');
    if (await pathExists(sdk)) {
      const size = await getSize(sdk);
      if (size > 0) {
        results.push({
          path: sdk,
          size,
          label: 'Android SDK',
          category: this.category,
          risk: this.risk,
          description: 'Android SDK — re-downloadable',
        });
      }
    }

    const avdRoot = path.join(HOME, '.android/avd');
    if (await isDirectory(avdRoot)) {
      for (const name of await listDir(avdRoot)) {
        const avdPath = path.join(avdRoot, name);
        if (!(await isDirectory(avdPath))) continue;
        const size = await getSize(avdPath);
        if (size < 100 * 1024 * 1024) continue;
        results.push({
          path: avdPath,
          size,
          label: `AVD: ${name}`,
          category: this.category,
          risk: this.risk,
          description: 'Android Virtual Device image',
        });
      }
    }

    const studioCaches = path.join(HOME, 'Library/Caches/Google');
    if (await isDirectory(studioCaches)) {
      for (const name of await listDir(studioCaches)) {
        if (!name.startsWith('AndroidStudio')) continue;
        const target = path.join(studioCaches, name);
        const size = await getSize(target);
        if (size < 10 * 1024 * 1024) continue;
        results.push({
          path: target,
          size,
          label: `Android Studio cache: ${name}`,
          category: this.category,
          risk: 'safe',
          description: 'Android Studio cache',
        });
      }
    }

    return results;
  }
}
