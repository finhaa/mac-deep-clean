import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsState = vi.hoisted(() => ({
  root: true,
  entries: [] as string[],
  dirs: new Set<string>(),
  sizes: new Map<string, number>(),
  owners: new Map<string, number>(),
  stuck: new Set<string>(),
}));

vi.mock('../utils/fs.js', () => ({
  isDirectory: async (p: string) => (p === '/Library/Caches' ? fsState.root : fsState.dirs.has(p)),
  listDir: async () => fsState.entries,
  getSize: async (p: string) => fsState.sizes.get(p) ?? 0,
  ownerUid: async (p: string) => fsState.owners.get(p),
  canRemoveTree: async (p: string) => !fsState.stuck.has(p),
}));

import { SystemCacheScanner } from './system-cache.js';

const MB = 1024 * 1024;
const ME = 501;
const realGetuid = process.getuid;

function entry(name: string, size: number, isDir = true, owner: number | null = ME): void {
  fsState.entries.push(name);
  const full = `/Library/Caches/${name}`;
  if (isDir) fsState.dirs.add(full);
  fsState.sizes.set(full, size);
  if (owner !== null) fsState.owners.set(full, owner);
}

beforeEach(() => {
  fsState.root = true;
  fsState.entries = [];
  fsState.dirs.clear();
  fsState.sizes.clear();
  fsState.owners.clear();
  fsState.stuck.clear();
  process.getuid = () => ME;
});

afterEach(() => {
  process.getuid = realGetuid;
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

  // /Library/Caches is sticky: only root or the entry's owner may remove an entry from it.
  it('offers a run without sudo only the entries it owns', async () => {
    entry('com.mine', 80 * MB);
    entry('com.root', 90 * MB, true, 0);
    entry('com.other', 70 * MB, true, 502);
    entry('com.gone', 60 * MB, true, null);
    const results = await new SystemCacheScanner().scan();
    expect(results.map((r) => r.label)).toEqual(['com.mine']);
  });

  it('offers a run under sudo every entry, whoever owns it', async () => {
    process.getuid = () => 0;
    entry('com.mine', 80 * MB);
    entry('com.root', 90 * MB, true, 0);
    entry('com.other', 70 * MB, true, 502);
    const results = await new SystemCacheScanner().scan();
    expect(results.map((r) => r.label)).toEqual(['com.root', 'com.mine', 'com.other']);
  });

  it('does not offer a run without sudo an entry it owns that holds what it cannot remove', async () => {
    entry('com.mine', 80 * MB);
    entry('com.mixed', 90 * MB);
    fsState.stuck.add('/Library/Caches/com.mixed');
    const results = await new SystemCacheScanner().scan();
    expect(results.map((r) => r.label)).toEqual(['com.mine']);
  });

  it('offers a run under sudo an entry whatever it holds', async () => {
    process.getuid = () => 0;
    entry('com.mixed', 90 * MB, true, 0);
    fsState.stuck.add('/Library/Caches/com.mixed');
    const results = await new SystemCacheScanner().scan();
    expect(results.map((r) => r.label)).toEqual(['com.mixed']);
  });
});
