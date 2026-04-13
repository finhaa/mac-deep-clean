import path from 'node:path';
import type { ScanResult } from '../types.js';
import { getSize, pathExists } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

export class MailDownloadsScanner extends BaseScanner {
  readonly name = 'Mail Downloads';
  readonly category = 'mail-downloads';
  readonly description = 'Apple Mail attachment downloads cache';
  readonly risk = 'safe' as const;

  async scan(): Promise<ScanResult[]> {
    const target = path.join(
      HOME,
      'Library/Containers/com.apple.mail/Data/Library/Mail Downloads',
    );
    if (!(await pathExists(target))) return [];
    const size = await getSize(target);
    if (size === 0) return [];
    return [
      {
        path: target,
        size,
        label: 'Mail Downloads',
        category: this.category,
        risk: this.risk,
        description: 'Attachment cache — Mail re-downloads on demand',
      },
    ];
  }
}
