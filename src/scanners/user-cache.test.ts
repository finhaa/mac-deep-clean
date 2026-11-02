import { describe, expect, it } from 'vitest';
import { isCoveredElsewhere } from './user-cache.js';

describe('isCoveredElsewhere', () => {
  it.each([
    'Arc',
    'Google',
    'Homebrew',
    'JetBrains',
    'com.apple.Safari',
    'CocoaPods',
    'ms-playwright',
    'ms-playwright-mcp',
  ])('skips %s, owned by another scanner or not a cache', (name) => {
    expect(isCoveredElsewhere(name)).toBe(true);
  });

  it.each(['pnpm', 'Dia', 'com.openai.codex', 'com.spotify.client', 'Arcade'])(
    'keeps %s in the generic scan',
    (name) => {
      expect(isCoveredElsewhere(name)).toBe(false);
    },
  );
});
