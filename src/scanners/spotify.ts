import path from 'node:path';
import type { ScanResult } from '../types.js';
import { getSize, pathExists } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

export class SpotifyScanner extends BaseScanner {
  readonly name = 'Spotify';
  readonly category = 'spotify';
  readonly description = 'Spotify PersistentCache and user caches';
  readonly risk = 'safe' as const;

  async scan(): Promise<ScanResult[]> {
    const targets: Array<{ path: string; label: string }> = [
      {
        path: path.join(
          HOME,
          'Library/Application Support/Spotify/PersistentCache',
        ),
        label: 'Spotify PersistentCache (App Support)',
      },
      {
        path: path.join(
          HOME,
          'Library/Caches/com.spotify.client/Data',
        ),
        label: 'Spotify Data cache',
      },
      {
        path: path.join(
          HOME,
          'Library/Containers/com.spotify.client/Data/Library/Application Support/Spotify/PersistentCache',
        ),
        label: 'Spotify PersistentCache (Container)',
      },
    ];
    const results: ScanResult[] = [];
    for (const t of targets) {
      if (!(await pathExists(t.path))) continue;
      const size = await getSize(t.path);
      if (size < 10 * 1024 * 1024) continue;
      results.push({
        path: t.path,
        size,
        label: t.label,
        category: this.category,
        risk: this.risk,
        description: 'Spotify cache — regenerates on playback',
      });
    }
    return results;
  }
}
