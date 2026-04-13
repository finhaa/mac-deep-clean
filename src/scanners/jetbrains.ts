import path from 'node:path';
import type { ScanResult } from '../types.js';
import { getSize, isDirectory, listDir } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

export class JetBrainsScanner extends BaseScanner {
  readonly name = 'JetBrains IDEs';
  readonly category = 'jetbrains';
  readonly description = 'JetBrains IDE caches, logs, and indexes';
  readonly risk = 'safe' as const;

  async scan(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    const roots = [
      { path: path.join(HOME, 'Library/Caches/JetBrains'), kind: 'caches' },
      { path: path.join(HOME, 'Library/Logs/JetBrains'), kind: 'logs' },
    ];

    for (const root of roots) {
      if (!(await isDirectory(root.path))) continue;
      for (const name of await listDir(root.path)) {
        if (name.startsWith('.')) continue;
        const target = path.join(root.path, name);
        if (!(await isDirectory(target))) continue;
        const size = await getSize(target);
        if (size < 10 * 1024 * 1024) continue;
        results.push({
          path: target,
          size,
          label: `${name} (${root.kind})`,
          category: this.category,
          risk: this.risk,
          description: `JetBrains ${root.kind} for ${name} — rebuilds on next launch`,
        });
      }
    }
    return results.sort((a, b) => b.size - a.size);
  }
}
