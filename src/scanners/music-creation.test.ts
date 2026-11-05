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

  it('says the user content is not re-downloadable, since every item is flagged irreversible', async () => {
    const results = await new MusicCreationScanner().scan();
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.irreversible === true)).toBe(true);
    expect(
      results.every((r) => r.description?.includes('your own instruments and presets do not')),
    ).toBe(true);
  });
});
