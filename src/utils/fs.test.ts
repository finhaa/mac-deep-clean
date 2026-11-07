import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearDir,
  getSize,
  isDirectory,
  listDir,
  pathExists,
  resolveDeletionTarget,
  safeRemove,
  sizeExcluding,
} from './fs.js';

let root: string;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-fs-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fsp.rm(root, { recursive: true, force: true });
});

describe('getSize with a hostile directory name', () => {
  it('measures a directory whose name holds quotes, $() and backticks without running any of it', async () => {
    const dir = path.join(root, 'it\'s "x" $(touch pwned) `touch pwned2`');
    await fsp.mkdir(dir);
    await fsp.writeFile(path.join(dir, 'f'), Buffer.alloc(8192));
    expect(await getSize(dir)).toBeGreaterThanOrEqual(8192);
    // an injected `touch` runs in the current directory, not in the measured one
    expect(await pathExists(path.join(process.cwd(), 'pwned'))).toBe(false);
    expect(await pathExists(path.join(process.cwd(), 'pwned2'))).toBe(false);
  });
});

describe('a symlinked parent component', () => {
  it('cannot lead safeRemove into a protected path', async () => {
    await fsp.symlink('/usr', path.join(root, 'link'));
    const rm = vi.spyOn(fsp, 'rm').mockResolvedValue();
    await expect(safeRemove(path.join(root, 'link', 'bin'))).rejects.toThrow(/protected/);
    expect(rm).not.toHaveBeenCalled();
  });

  it('cannot lead clearDir into a protected path', async () => {
    await fsp.symlink('/usr', path.join(root, 'link'));
    const rm = vi.spyOn(fsp, 'rm').mockResolvedValue();
    const { freed, errors } = await clearDir(path.join(root, 'link', 'bin'));
    expect(freed).toBe(0);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((e) => e.includes('protected'))).toBe(true);
    expect(rm).not.toHaveBeenCalled();
  });

  it('still removes a symlinked leaf as a link and leaves its target alone', async () => {
    const outside = path.join(root, 'outside');
    await fsp.mkdir(outside);
    await fsp.writeFile(path.join(outside, 'keep'), 'x');
    await fsp.symlink(outside, path.join(root, 'leaf'));
    await safeRemove(path.join(root, 'leaf'));
    expect(await pathExists(path.join(root, 'leaf'))).toBe(false);
    expect(await pathExists(path.join(outside, 'keep'))).toBe(true);
  });
});

describe('clearDir', () => {
  it('removes every child and keeps the directory', async () => {
    await fsp.writeFile(path.join(root, 'a'), 'x');
    await fsp.mkdir(path.join(root, 'b'));
    await fsp.writeFile(path.join(root, 'b', 'c'), 'x');
    expect((await clearDir(root)).errors).toEqual([]);
    expect(await fsp.readdir(root)).toEqual([]);
  });

  it('returns an error for each child it could not remove and still clears the rest', async () => {
    await fsp.writeFile(path.join(root, 'locked'), 'x');
    await fsp.writeFile(path.join(root, 'free'), 'x');
    const realRm = fsp.rm.bind(fsp);
    vi.spyOn(fsp, 'rm').mockImplementation(async (target, options) => {
      if (String(target).endsWith('locked')) throw new Error('EACCES: permission denied');
      return realRm(target, options);
    });
    const { errors } = await clearDir(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('locked');
    expect(errors[0]).toContain('EACCES');
    expect(await fsp.readdir(root)).toEqual(['locked']);
  });

  it('keeps the named children and reports the bytes of the ones it removed', async () => {
    await fsp.writeFile(path.join(root, 'keep'), Buffer.alloc(300 * 1024));
    await fsp.writeFile(path.join(root, 'drop'), Buffer.alloc(500 * 1024));
    const { freed, errors } = await clearDir(root, ['keep']);
    expect(errors).toEqual([]);
    expect(freed).toBeGreaterThan(400 * 1024);
    expect(freed).toBeLessThan(600 * 1024);
    expect(await fsp.readdir(root)).toEqual(['keep']);
  });

  it('does not count a child as freed when removal reports success but it is still there', async () => {
    await fsp.writeFile(path.join(root, 'stuck'), Buffer.alloc(300 * 1024));
    vi.spyOn(fsp, 'rm').mockImplementation(async () => {});
    const { freed, errors } = await clearDir(root);
    expect(freed).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('still exists');
  });
});

describe('pathExists, isDirectory and listDir', () => {
  it('tell files, directories, symlinks and missing paths apart', async () => {
    await fsp.writeFile(path.join(root, 'file'), 'x');
    await fsp.mkdir(path.join(root, 'dir'));
    await fsp.symlink(path.join(root, 'dir'), path.join(root, 'link'));
    expect(await pathExists(path.join(root, 'file'))).toBe(true);
    expect(await pathExists(path.join(root, 'link'))).toBe(true);
    expect(await pathExists(path.join(root, 'missing'))).toBe(false);
    expect(await isDirectory(path.join(root, 'dir'))).toBe(true);
    expect(await isDirectory(path.join(root, 'link'))).toBe(false);
    expect(await isDirectory(path.join(root, 'file'))).toBe(false);
    expect((await listDir(root)).sort()).toEqual(['dir', 'file', 'link']);
    expect(await listDir(path.join(root, 'missing'))).toEqual([]);
  });
});

describe('getSize', () => {
  it('is the byte size of a file, 0 for a symlink or a missing path, and the disk usage of a directory', async () => {
    await fsp.writeFile(path.join(root, 'file'), Buffer.alloc(1234));
    await fsp.mkdir(path.join(root, 'dir'));
    await fsp.writeFile(path.join(root, 'dir', 'big'), Buffer.alloc(300 * 1024));
    await fsp.symlink(path.join(root, 'dir'), path.join(root, 'link'));
    expect(await getSize(path.join(root, 'file'))).toBe(1234);
    expect(await getSize(path.join(root, 'link'))).toBe(0);
    expect(await getSize(path.join(root, 'missing'))).toBe(0);
    expect(await getSize(path.join(root, 'dir'))).toBeGreaterThanOrEqual(300 * 1024);
  });

  it('handles a path with quotes, dollar signs and backticks without running anything', async () => {
    const odd = path.join(root, 'a"b$HOME`id`');
    await fsp.mkdir(odd);
    await fsp.writeFile(path.join(odd, 'f'), Buffer.alloc(8 * 1024));
    expect(await getSize(odd)).toBeGreaterThanOrEqual(8 * 1024);
  });
});

describe('safeRemove', () => {
  it('removes a folder and ignores a missing path', async () => {
    const dir = path.join(root, 'gone');
    await fsp.mkdir(dir);
    await fsp.writeFile(path.join(dir, 'f'), 'x');
    await safeRemove(dir);
    expect(await pathExists(dir)).toBe(false);
    await expect(safeRemove(path.join(root, 'never-existed'))).resolves.toBeUndefined();
  });

  it('refuses a protected path before touching anything', async () => {
    await expect(safeRemove(os.homedir())).rejects.toThrow(/Refusing to delete/);
    await expect(safeRemove('/')).rejects.toThrow(/Refusing to delete/);
  });
});

// The default macOS volume folds case and Unicode spellings; a case-sensitive volume (Linux CI, or a
// case-sensitive APFS) does not, so these run only where the temp dir answers to an upper-cased spelling.
const tmpFoldsCase = fs.existsSync(os.tmpdir().toUpperCase());

describe.skipIf(!tmpFoldsCase)('a leaf spelled another way on the default volume', () => {
  it('is checked and removed under the spelling the kernel resolves it to', async () => {
    await fsp.mkdir(path.join(root, 'Folder'));
    const real = await fsp.realpath(root);
    expect(await resolveDeletionTarget(path.join(root, 'FOLDER'))).toBe(path.join(real, 'Folder'));
  });

  it('cannot reach a protected folder through a capital sharp s', async () => {
    const home = path.join(root, 'home');
    await fsp.mkdir(path.join(home, '.ssh'), { recursive: true });
    await fsp.writeFile(path.join(home, '.ssh', 'id_decoy'), 'x');
    try {
      vi.resetModules();
      vi.stubEnv('HOME', home);
      vi.spyOn(os, 'userInfo').mockReturnValue({ homedir: home } as os.UserInfo<string>);
      const fresh = await import('./fs.js');
      await expect(fresh.safeRemove(path.join(home, '.ẞh'))).rejects.toThrow(/protected/);
      expect(await pathExists(path.join(home, '.ssh', 'id_decoy'))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe('sizeExcluding', () => {
  it('adds up the children except the ones to keep', async () => {
    await fsp.writeFile(path.join(root, 'a'), Buffer.alloc(100));
    await fsp.writeFile(path.join(root, 'b'), Buffer.alloc(200));
    await fsp.writeFile(path.join(root, 'c'), Buffer.alloc(400));
    expect(await sizeExcluding(root, ['c'])).toBe(300);
    expect(await sizeExcluding(root, [])).toBe(700);
  });
});
