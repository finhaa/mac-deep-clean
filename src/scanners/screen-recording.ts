import path from 'node:path';
import type { ScanResult } from '../types.js';
import { getSize, pathExists } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

const APPS = [
  { name: 'Cap', dir: 'so.cap.desktop' },
  { name: 'Screen Studio', dir: 'Screen Studio' },
  { name: 'OBS', dir: 'com.obsproject.obs-studio' },
];

export class ScreenRecordingScanner extends BaseScanner {
  readonly name = 'Screen Recording';
  readonly category = 'screen-recording';
  readonly description = 'Cap, Screen Studio, OBS caches and project data';
  readonly risk = 'moderate' as const;

  async scan(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    const appSupport = path.join(HOME, 'Library/Application Support');

    for (const { name, dir } of APPS) {
      const target = path.join(appSupport, dir);
      if (!(await pathExists(target))) continue;
      const size = await getSize(target);
      if (size < 10 * 1024 * 1024) continue;
      results.push({
        path: target,
        size,
        label: `${name} data`,
        category: this.category,
        risk: this.risk,
        description: `${name} application data (may include recordings)`,
      });
    }
    return results;
  }
}
