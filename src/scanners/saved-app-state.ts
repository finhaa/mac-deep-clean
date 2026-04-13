import path from 'node:path';
import type { ScanResult } from '../types.js';
import { getSize, pathExists } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

export class SavedAppStateScanner extends BaseScanner {
  readonly name = 'Saved Application State';
  readonly category = 'saved-app-state';
  readonly description = '~/Library/Saved Application State (window-restore data)';
  readonly risk = 'safe' as const;

  async scan(): Promise<ScanResult[]> {
    const target = path.join(HOME, 'Library/Saved Application State');
    if (!(await pathExists(target))) return [];
    const size = await getSize(target);
    if (size === 0) return [];
    return [
      {
        path: target,
        size,
        label: 'Saved Application State',
        category: this.category,
        risk: this.risk,
        description: 'Apps lose window positions on next launch — regenerates',
      },
    ];
  }
}
