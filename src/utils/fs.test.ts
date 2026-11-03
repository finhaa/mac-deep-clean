import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDir } from './fs.js';

let root: string;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-fs-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fsp.rm(root, { recursive: true, force: true });
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
