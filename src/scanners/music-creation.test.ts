import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/fs.js', () => ({
  pathExists: vi.fn(async () => true),
  getSize: vi.fn(async () => 500 * 1024 * 1024),
}));

import { MusicCreationScanner } from './music-creation.js';

describe('MusicCreationScanner', () => {
  it('never offers ~/Library/Audio, which holds third-party plug-ins and presets', async () => {
    const paths = (await new MusicCreationScanner().scan()).map((r) => r.path);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some((p) => p.endsWith('/Library/Audio') && !p.startsWith('/Library/'))).toBe(
      false,
    );
  });
});
