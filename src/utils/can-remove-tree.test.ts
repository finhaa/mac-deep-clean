import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canRemoveTree } from './fs.js';

const realGetuid = process.getuid;
const isRoot = process.getuid?.() === 0;
let root: string;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-tree-'));
  await fsp.mkdir(path.join(root, 'a', 'b'), { recursive: true });
  await fsp.writeFile(path.join(root, 'a', 'b', 'file'), 'x');
});

afterEach(async () => {
  process.getuid = realGetuid;
  for (const dir of [path.join(root, 'a', 'b'), path.join(root, 'a'), root]) {
    await fsp.chmod(dir, 0o700).catch(() => {});
  }
  await fsp.rm(root, { recursive: true, force: true });
});

describe('canRemoveTree', () => {
  it('says yes for a tree this process owns', async () => {
    expect(await canRemoveTree(root)).toBe(true);
  });

  it('says no for a missing path', async () => {
    expect(await canRemoveTree(path.join(root, 'missing'))).toBe(false);
  });

  it.skipIf(isRoot)('says no when a folder deep inside is read-only', async () => {
    await fsp.chmod(path.join(root, 'a', 'b'), 0o500);
    expect(await canRemoveTree(root)).toBe(false);
  });

  it.skipIf(isRoot)('says no when a folder deep inside cannot be listed', async () => {
    await fsp.chmod(path.join(root, 'a', 'b'), 0o300);
    expect(await canRemoveTree(root)).toBe(false);
  });

  it.skipIf(isRoot)('says no when a folder deep inside cannot be searched', async () => {
    await fsp.chmod(path.join(root, 'a', 'b'), 0o600);
    expect(await canRemoveTree(root)).toBe(false);
  });

  it('does not follow a symlink to a folder it could not remove from', async () => {
    await fsp.symlink('/', path.join(root, 'a', 'link'));
    expect(await canRemoveTree(root)).toBe(true);
  });

  it('says no for a sticky folder holding entries another user owns', async () => {
    await fsp.chmod(path.join(root, 'a'), 0o1777);
    const me = process.getuid?.() ?? 0;
    process.getuid = () => me + 1;
    expect(await canRemoveTree(root)).toBe(false);
  });

  it('ignores who owns the entries of a folder that is not sticky', async () => {
    await fsp.chmod(path.join(root, 'a'), 0o777);
    const me = process.getuid?.() ?? 0;
    process.getuid = () => me + 1;
    expect(await canRemoveTree(root)).toBe(true);
  });
});
