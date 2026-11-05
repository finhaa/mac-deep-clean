import path from 'node:path';
import type { ScanResult } from '../types.js';
import { getSize, pathExists } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

export class MusicCreationScanner extends BaseScanner {
  readonly name = 'Music Creation';
  readonly category = 'music-creation';
  readonly description = 'GarageBand, Logic Pro sound libraries and content';
  readonly risk = 'moderate' as const;

  async scan(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    const targets: Array<{ path: string; label: string }> = [
      {
        path: path.join(HOME, 'Library/Application Support/GarageBand'),
        label: 'GarageBand (user)',
      },
      { path: path.join(HOME, 'Library/Application Support/Logic'), label: 'Logic (user)' },
      { path: '/Library/Audio/Apple Loops', label: 'Apple Loops (system)' },
      { path: '/Library/Application Support/GarageBand', label: 'GarageBand (system)' },
      { path: '/Library/Application Support/Logic', label: 'Logic (system)' },
    ];

    for (const t of targets) {
      if (!(await pathExists(t.path))) continue;
      const size = await getSize(t.path);
      if (size < 100 * 1024 * 1024) continue;
      results.push({
        path: t.path,
        size,
        label: t.label,
        category: this.category,
        risk: this.risk,
        irreversible: true,
        description:
          'Sound library — Apple content re-downloads from the app, your own instruments and presets do not',
      });
    }
    return results;
  }
}
