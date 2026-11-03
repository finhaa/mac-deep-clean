import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ora', () => {
  const spinner = { start: () => spinner, succeed: () => spinner, fail: () => spinner };
  return { default: () => spinner };
});

import { duplicatesCommand } from './duplicates.js';

let root: string;

const logged = () =>
  vi
    .mocked(console.log)
    .mock.calls.map((c) => c.join(' '))
    .join('\n');

async function write(rel: string, content: string | Buffer): Promise<void> {
  const file = path.join(root, rel);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content);
}

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-dup-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  await fsp.rm(root, { recursive: true, force: true });
});

describe('duplicatesCommand', () => {
  it('groups byte-identical files and never deletes anything', async () => {
    await write('a/one.bin', 'same content here');
    await write('b/two.bin', 'same content here');
    await write('c/three.bin', 'other content!!!!');
    await duplicatesCommand(root, { minSize: '1B' });
    expect(logged()).toContain('1 duplicate group');
    expect(logged()).toContain('one.bin');
    expect(logged()).toContain('two.bin');
    expect(logged()).not.toContain('three.bin');
    expect((await fsp.readdir(path.join(root, 'a'))).length).toBe(1);
  });

  it('does not call same-size files with different content duplicates', async () => {
    await write('one.bin', 'aaaaaaaa');
    await write('two.bin', 'bbbbbbbb');
    await duplicatesCommand(root, { minSize: '1B' });
    expect(logged()).toContain('No actual duplicates found');
  });

  it('ignores files below the minimum size', async () => {
    await write('one.bin', 'tiny');
    await write('two.bin', 'tiny');
    await duplicatesCommand(root, { minSize: '1KB' });
    expect(logged()).toContain('No duplicate candidates by size');
  });

  it('skips dependency folders, hidden files and symlinks', async () => {
    await write('keep.bin', 'dupe dupe dupe!');
    await write('node_modules/x.bin', 'dupe dupe dupe!');
    await write('.hidden.bin', 'dupe dupe dupe!');
    await fsp.symlink(path.join(root, 'keep.bin'), path.join(root, 'link.bin'));
    await duplicatesCommand(root, { minSize: '1B' });
    expect(logged()).toContain('No duplicate candidates by size');
  });

  it('shows only the top groups and counts the rest', async () => {
    for (const n of [1, 2, 3]) {
      await write(`g${n}/a.bin`, `group-${n}`.repeat(n));
      await write(`g${n}/b.bin`, `group-${n}`.repeat(n));
    }
    await duplicatesCommand(root, { minSize: '1B', top: '1' });
    expect(logged()).toContain('3 duplicate group');
    expect(logged()).toContain('and 2 more group');
  });

  it('understands size suffixes', async () => {
    await write('one.bin', Buffer.alloc(2048, 1));
    await write('two.bin', Buffer.alloc(2048, 1));
    await duplicatesCommand(root, { minSize: '2K' });
    expect(logged()).toContain('1 duplicate group');
    vi.mocked(console.log).mockClear();
    await duplicatesCommand(root, { minSize: '3K' });
    expect(logged()).toContain('No duplicate candidates by size');
  });

  it('fails on a path that is not a directory', async () => {
    await duplicatesCommand(path.join(root, 'missing'), {});
    expect(process.exitCode).toBe(1);
  });
});
