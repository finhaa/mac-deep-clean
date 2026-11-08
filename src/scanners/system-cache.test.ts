import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsState = vi.hoisted(() => ({
  root: true,
  entries: [] as string[],
  dirs: new Set<string>(),
  sizes: new Map<string, number>(),
}));

vi.mock('../utils/fs.js', () => ({
  isDirectory: async (p: string) => (p === '/Library/Caches' ? fsState.root : fsState.dirs.has(p)),
  listDir: async () => fsState.entries,
  getSize: async (p: string) => fsState.sizes.get(p) ?? 0,
}));

import { SystemCacheScanner } from './system-cache.js';

const MB = 1024 * 1024;

function entry(name: string, size: number, isDir = true): void {
  fsState.entries.push(name);
  const full = `/Library/Caches/${name}`;
  if (isDir) fsState.dirs.add(full);
  fsState.sizes.set(full, size);
}

beforeEach(() => {
  fsState.root = true;
  fsState.entries = [];
  fsState.dirs.clear();
  fsState.sizes.clear();
});

describe('SystemCacheScanner', () => {
  it('reports cache folders of 50 MB or more, largest first, as moderate', async () => {
    entry('com.small', 50 * MB - 1);
    entry('com.mid', 60 * MB);
    entry('com.big', 90 * MB);
    const results = await new SystemCacheScanner().scan();
    expect(results.map((r) => r.label)).toEqual(['com.big', 'com.mid']);
    expect(results.every((r) => r.risk === 'moderate')).toBe(true);
  });

  it('draws the 50 MB line at the byte', async () => {
    entry('com.below', 50 * MB - 1);
    entry('com.at', 50 * MB);
    entry('com.above', 50 * MB + 1);
    const results = await new SystemCacheScanner().scan();
    expect(results.map((r) => r.label)).toEqual(['com.above', 'com.at']);
  });

  it('skips hidden entries and plain files', async () => {
    entry('.hidden', 900 * MB);
    entry('file.bin', 900 * MB, false);
    expect(await new SystemCacheScanner().scan()).toEqual([]);
  });

  it('reports nothing when /Library/Caches is not a directory', async () => {
    fsState.root = false;
    expect(await new SystemCacheScanner().scan()).toEqual([]);
  });
});
