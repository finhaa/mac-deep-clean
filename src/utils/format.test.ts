import { describe, expect, it } from 'vitest';
import { colorRisk, colorSize, formatBytes, stripControl, truncate } from './format.js';

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

describe('truncate', () => {
  it('keeps a string that fits and cuts one that does not, ending in an ellipsis', () => {
    expect(truncate('abc', 3)).toBe('abc');
    expect(truncate('abcd', 3)).toBe('ab…');
  });
});

describe('colorRisk and colorSize', () => {
  it('always keep the plain text', () => {
    expect(colorRisk('safe')).toContain('safe');
    expect(colorRisk('moderate')).toContain('moderate');
    expect(colorRisk('risky')).toContain('risky');
    expect(colorSize(512)).toContain('512 B');
    expect(colorSize(2 * 1024 ** 3)).toContain('2.0 GB');
    expect(colorSize(20 * 1024 ** 3)).toContain('20.0 GB');
  });
});

describe('stripControl', () => {
  it('replaces escape sequences, carriage returns, newlines and C1 controls with a question mark', () => {
    expect(stripControl('a\u001b[2Kb')).toBe('a?[2Kb');
    expect(stripControl('a\rb\nc\u007fd\u009be\u0000f')).toBe('a?b?c?d?e?f');
  });

  it('covers the whole control ranges, both ends included', () => {
    for (const code of [0x00, 0x1f, 0x7f, 0x80, 0x9f]) {
      expect(stripControl(`a${String.fromCharCode(code)}b`), `U+${code.toString(16)}`).toBe('a?b');
    }
    expect(stripControl('a b\u00a0c')).toBe('a b\u00a0c');
  });

  it('keeps ordinary text, spaces and non-ASCII letters', () => {
    expect(stripControl('node_modules café 日本')).toBe('node_modules café 日本');
  });

  it('is applied by truncate, so a hostile label cannot rewrite its own line', () => {
    expect(truncate('evil\u001b[2K\rname', 50)).toBe('evil?[2K?name');
  });
});
