import { describe, expect, it } from 'vitest';
import { formatBytes } from './format.js';

describe('formatBytes', () => {
  it('handles zero', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats KB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
  });

  it('formats MB', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('formats GB', () => {
    expect(formatBytes(2.5 * 1024 ** 3)).toBe('2.5 GB');
  });

  it('uses no decimals for values ≥ 100', () => {
    expect(formatBytes(150 * 1024 ** 3)).toBe('150 GB');
  });
});
