import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/fs.js', () => ({
  pathExists: vi.fn(async () => true),
  getSize: vi.fn(async () => 100 * 1024 * 1024),
}));

import { SpotifyScanner } from './spotify.js';

describe('SpotifyScanner', () => {
  it('leaves ~/Library/Caches/com.spotify.client to the generic cache scanner', async () => {
    const paths = (await new SpotifyScanner().scan()).map((r) => r.path);
    expect(paths.some((p) => p.includes('/Library/Caches/com.spotify.client'))).toBe(false);
  });
});
