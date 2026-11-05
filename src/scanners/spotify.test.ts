import { beforeEach, describe, expect, it, vi } from 'vitest';

const sizes = vi.hoisted(() => ({ value: 100 * 1024 * 1024 }));

vi.mock('../utils/fs.js', () => ({
  pathExists: vi.fn(async () => true),
  getSize: vi.fn(async () => sizes.value),
}));

import path from 'node:path';
import { HOME } from '../utils/paths.js';
import { SpotifyScanner } from './spotify.js';

beforeEach(() => {
  sizes.value = 100 * 1024 * 1024;
});

describe('SpotifyScanner', () => {
  it('reports exactly the two PersistentCache folders under the home folder, each with its label', async () => {
    const results = await new SpotifyScanner().scan();

    expect(results.map((r) => [r.path, r.label])).toEqual([
      [
        path.join(HOME, 'Library/Application Support/Spotify/PersistentCache'),
        'Spotify PersistentCache (App Support)',
      ],
      [
        path.join(
          HOME,
          'Library/Containers/com.spotify.client/Data/Library/Application Support/Spotify/PersistentCache',
        ),
        'Spotify PersistentCache (Container)',
      ],
    ]);
  });

  it('reports both PersistentCache folders', async () => {
    const paths = (await new SpotifyScanner().scan()).map((r) => r.path);
    expect(paths).toHaveLength(2);
    expect(paths.every((p) => p.endsWith('Spotify/PersistentCache'))).toBe(true);
  });

  it('leaves ~/Library/Caches/com.spotify.client to the generic cache scanner', async () => {
    const paths = (await new SpotifyScanner().scan()).map((r) => r.path);
    expect(paths.some((p) => p.includes('/Library/Caches/com.spotify.client'))).toBe(false);
  });

  it('skips a cache under 10 MB and keeps one at exactly 10 MB', async () => {
    sizes.value = 10 * 1024 * 1024 - 1;
    expect(await new SpotifyScanner().scan()).toEqual([]);
    sizes.value = 10 * 1024 * 1024;
    expect(await new SpotifyScanner().scan()).toHaveLength(2);
  });
});
