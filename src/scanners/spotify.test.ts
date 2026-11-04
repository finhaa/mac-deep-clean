import { beforeEach, describe, expect, it, vi } from 'vitest';

const sizes = vi.hoisted(() => ({ value: 100 * 1024 * 1024 }));

vi.mock('../utils/fs.js', () => ({
  pathExists: vi.fn(async () => true),
  getSize: vi.fn(async () => sizes.value),
}));

import { SpotifyScanner } from './spotify.js';

beforeEach(() => {
  sizes.value = 100 * 1024 * 1024;
});

describe('SpotifyScanner', () => {
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
