import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { colorRisk, colorSize, formatBytes, stripControl, tildify, truncate } from './format.js';
import { HOME } from './paths.js';

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

  it('also hides what reorders or hides text: bidi controls, zero-width characters and the byte order mark', () => {
    const ranges: Array<[number, number]> = [
      [0x200b, 0x200f],
      [0x202a, 0x202e],
      [0x2060, 0x2064],
      [0x2066, 0x2069],
      [0xfeff, 0xfeff],
    ];
    for (const [from, to] of ranges) {
      for (const code of [from, to]) {
        expect(stripControl(`a${String.fromCharCode(code)}b`), `U+${code.toString(16)}`).toBe(
          'a?b',
        );
      }
    }
    expect(stripControl('evil\u202Egpj.exe')).toBe('evil?gpj.exe');
  });

  it('keeps the characters right next to those ranges', () => {
    for (const code of [0x200a, 0x2010, 0x2029, 0x202f, 0x205f, 0x2065, 0x206a, 0xfefe, 0xff00]) {
      const text = `a${String.fromCharCode(code)}b`;
      expect(stripControl(text), `U+${code.toString(16)}`).toBe(text);
    }
  });

  it('keeps ordinary text, spaces and non-ASCII letters', () => {
    expect(stripControl('node_modules café 日本')).toBe('node_modules café 日本');
  });

  it('is applied by truncate, so a hostile label cannot rewrite its own line', () => {
    expect(truncate('evil\u001b[2K\rname', 50)).toBe('evil?[2K?name');
  });
});

describe('tildify', () => {
  it('writes HOME as ~ and a path inside it as ~/...', () => {
    expect(tildify(HOME)).toBe('~');
    expect(tildify(path.join(HOME, 'Library/Mail'))).toBe('~/Library/Mail');
  });

  it('leaves a sibling that only shares the HOME prefix alone', () => {
    expect(tildify(`${HOME}ael/Library`)).toBe(`${HOME}ael/Library`);
  });

  it('leaves a path outside HOME alone', () => {
    expect(tildify('/Volumes/disk/x')).toBe('/Volumes/disk/x');
  });
});

describe('tildify with a HOME that is spelled unusually', () => {
  async function freshTildify(home: string) {
    vi.resetModules();
    vi.stubEnv('HOME', home);
    return (await import('./format.js')).tildify;
  }

  it('strips a trailing slash from HOME instead of slicing into the child name', async () => {
    try {
      const fresh = await freshTildify('/mdc-missing/home/');
      expect(fresh('/mdc-missing/home/proj/one.bin')).toBe('~/proj/one.bin');
      expect(fresh('/mdc-missing/home')).toBe('~');
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('shortens a precomposed path under a decomposed HOME', async () => {
    try {
      const fresh = await freshTildify('/mdc-missing/jose\u0301');
      expect(fresh('/mdc-missing/jos\u00e9/proj')).toBe('~/proj');
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('resolves a path with dot segments before shortening it', async () => {
    try {
      const fresh = await freshTildify('/mdc-missing/home');
      expect(fresh('/mdc-missing/home/proj/../other')).toBe('~/other');
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('shortens a decomposed spelling of HOME', async () => {
    try {
      const fresh = await freshTildify('/mdc-missing/jos\u00e9');
      expect(fresh('/mdc-missing/jose\u0301/proj')).toBe('~/proj');
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
