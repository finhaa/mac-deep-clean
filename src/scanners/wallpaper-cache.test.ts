import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/fs.js', () => ({
  pathExists: vi.fn(async () => true),
  getSize: vi.fn(async () => 1000),
}));

import { WallpaperCacheScanner } from './wallpaper-cache.js';

describe('WallpaperCacheScanner', () => {
  it('targets the aerials downloads, not the whole settings directory', async () => {
    const paths = (await new WallpaperCacheScanner().scan()).map((r) => r.path);
    expect(paths.some((p) => p.endsWith('/Application Support/com.apple.wallpaper/aerials'))).toBe(
      true,
    );
    expect(paths.some((p) => p.endsWith('/Application Support/com.apple.wallpaper'))).toBe(false);
  });
});
