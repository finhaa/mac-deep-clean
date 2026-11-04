import fs, { rmSync as namedRmSync } from 'node:fs';
import fsp, { rm as namedRm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const never = (base: string) => path.join(base, 'mdc-never-here');
const outside = ['/usr/bin', os.homedir()];

describe('vitest.setup.ts delete guard', () => {
  // Only paths that do not exist: if the guard regressed, these tests must still delete nothing.
  describe.each(outside)('refuses to change anything under %s', (base) => {
    const target = never(base);
    const inside = path.join(os.tmpdir(), 'mdc-guard-inside');

    it.each(['rm', 'rmdir', 'unlink', 'truncate'] as const)('promises %s', async (name) => {
      await expect((fsp[name] as (p: string) => Promise<void>)(target)).rejects.toThrow(
        /test guard/,
      );
    });

    it.each(['rm', 'rmdir', 'unlink', 'truncate'] as const)('sync %sSync', (name) => {
      const fn = fs[`${name}Sync` as 'rmSync'] as unknown as (p: string) => void;
      expect(() => fn(target)).toThrow(/test guard/);
    });

    it.each(['rm', 'rmdir', 'unlink', 'truncate'] as const)('callback %s', (name) => {
      const fn = fs[name] as unknown as (p: string, cb: () => void) => void;
      expect(() => fn(target, () => {})).toThrow(/test guard/);
    });

    it('cp overwriting it, in every flavour', async () => {
      await expect(fsp.cp(inside, target)).rejects.toThrow(/test guard/);
      expect(() => fs.cpSync(inside, target)).toThrow(/test guard/);
      expect(() => fs.cp(inside, target, () => {})).toThrow(/test guard/);
    });

    it('rename away from or onto it, in every flavour', async () => {
      await expect(fsp.rename(target, inside)).rejects.toThrow(/test guard/);
      await expect(fsp.rename(inside, target)).rejects.toThrow(/test guard/);
      expect(() => fs.renameSync(target, inside)).toThrow(/test guard/);
      expect(() => fs.renameSync(inside, target)).toThrow(/test guard/);
      expect(() => fs.rename(target, inside, () => {})).toThrow(/test guard/);
      expect(() => fs.rename(inside, target, () => {})).toThrow(/test guard/);
    });

    it('a named import of rm or rmSync', async () => {
      await expect(namedRm(target, { recursive: true, force: true })).rejects.toThrow(/test guard/);
      expect(() => namedRmSync(target, { recursive: true, force: true })).toThrow(/test guard/);
    });
  });

  it('refuses the temp dir itself, which a test never needs to remove', async () => {
    await expect(fsp.rmdir(os.tmpdir())).rejects.toThrow(/test guard/);
    await expect(fsp.unlink(os.tmpdir())).rejects.toThrow(/test guard/);
    expect(() => fs.rmdirSync(os.tmpdir())).toThrow(/test guard/);
    expect(() => fs.rmSync(os.tmpdir())).toThrow(/test guard/);
  });

  it('refuses a path that climbs out of the temp dir', async () => {
    const climbing = path.join(os.tmpdir(), '..', '..', 'usr', 'bin', 'mdc-never-here');
    await expect(fsp.rm(climbing, { force: true })).rejects.toThrow(/test guard/);
  });

  it('refuses a path under a symlink in the temp dir that points outside it', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-guard-'));
    const link = path.join(dir, 'link');
    await fsp.symlink(os.homedir(), link);
    await expect(fsp.rm(path.join(link, 'mdc-never-here'), { force: true })).rejects.toThrow(
      /test guard/,
    );
    expect(() => fs.rmSync(path.join(link, 'mdc-never-here'), { force: true })).toThrow(
      /test guard/,
    );
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('still lets a test remove the symlink itself, which removes only the link', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-guard-'));
    const target = path.join(dir, 'target');
    await fsp.mkdir(target);
    await fsp.symlink(target, path.join(dir, 'link'));
    await fsp.rm(path.join(dir, 'link'));
    await expect(fsp.stat(target)).resolves.toBeDefined();
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('still deletes, copies, renames and truncates inside the temp dir', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-guard-'));
    const a = path.join(dir, 'a');
    await fsp.writeFile(a, 'xyz');
    await fsp.cp(a, path.join(dir, 'b'));
    await fsp.rename(path.join(dir, 'b'), path.join(dir, 'c'));
    await fsp.truncate(path.join(dir, 'c'), 1);
    expect((await fsp.readFile(path.join(dir, 'c'))).toString()).toBe('x');
    await namedRm(path.join(dir, 'c'));
    fs.rmSync(a);
    await fsp.rm(dir, { recursive: true, force: true });
    await expect(fsp.stat(dir)).rejects.toThrow();
  });
});
