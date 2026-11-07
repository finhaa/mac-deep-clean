import fs, { rmSync as namedRmSync } from 'node:fs';
import fsp, { rm as namedRm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

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

  it('refuses a path whose parent does not exist, outside the temp dir', async () => {
    const target = path.join('/usr/bin', 'mdc-no-such-dir', 'x');
    await expect(fsp.rm(target, { force: true })).rejects.toThrow(/test guard/);
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

  // Each of these is a path the kernel resolves differently from the string the guard sees. The targets are
  // non-recursive calls on a directory the OS protects or on a name that does not exist, so a regressed guard
  // fails the assertion without deleting or creating anything that matters.
  describe('acts on the path the kernel acts on', () => {
    async function linkTo(target: string): Promise<{ dir: string; link: string }> {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-guard-'));
      const link = path.join(dir, 'link');
      await fsp.symlink(target, link);
      return { dir, link };
    }

    it('refuses a trailing slash on a symlink in the temp dir that points outside it', async () => {
      const { dir, link } = await linkTo('/usr/bin');
      await expect(fsp.rm(`${link}/`)).rejects.toThrow(/test guard/);
      await expect(fsp.rmdir(`${link}/`)).rejects.toThrow(/test guard/);
      expect(() => fs.rmSync(`${link}/`)).toThrow(/test guard/);
      expect(() => fs.rmSync(`${link}/.`)).toThrow(/test guard/);
      await fsp.rm(dir, { recursive: true, force: true });
    });

    it('refuses to truncate through a symlink in the temp dir that points outside it', async () => {
      const { dir, link } = await linkTo('/usr/bin/mdc-never-here');
      await expect(fsp.truncate(link)).rejects.toThrow(/test guard/);
      expect(() => fs.truncateSync(link)).toThrow(/test guard/);
      await fsp.rm(dir, { recursive: true, force: true });
    });

    it('refuses a file: URL outside the temp dir, whatever the working directory', async () => {
      const url = pathToFileURL('/usr/bin/mdc-never-here');
      await expect(fsp.rm(url, { force: true })).rejects.toThrow(/test guard/);
      expect(() => fs.rmSync(url, { force: true })).toThrow(/test guard/);
    });

    it('still accepts a file: URL inside the temp dir', async () => {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-guard-'));
      const file = path.join(dir, 'f');
      await fsp.writeFile(file, 'x');
      await fsp.rm(pathToFileURL(file));
      await expect(fsp.stat(file)).rejects.toThrow();
      await fsp.rm(dir, { recursive: true, force: true });
    });

    it.each([
      ['writeFile', (t: string) => fsp.writeFile(t, 'x')],
      ['appendFile', (t: string) => fsp.appendFile(t, 'x')],
      ['copyFile', (t: string) => fsp.copyFile(import.meta.filename, t)],
    ])('refuses fsp.%s onto a path outside the temp dir', async (_name, call) => {
      await expect(call('/usr/bin/mdc-never-here')).rejects.toThrow(/test guard/);
    });

    it('refuses the sync and callback flavours of writeFile, appendFile and copyFile', () => {
      const target = '/usr/bin/mdc-never-here';
      expect(() => fs.writeFileSync(target, 'x')).toThrow(/test guard/);
      expect(() => fs.appendFileSync(target, 'x')).toThrow(/test guard/);
      expect(() => fs.copyFileSync(import.meta.filename, target)).toThrow(/test guard/);
      expect(() => fs.writeFile(target, 'x', () => {})).toThrow(/test guard/);
      expect(() => fs.appendFile(target, 'x', () => {})).toThrow(/test guard/);
      expect(() => fs.copyFile(import.meta.filename, target, () => {})).toThrow(/test guard/);
    });

    it('refuses a write through a symlink in the temp dir that points outside it', async () => {
      const { dir, link } = await linkTo('/usr/bin/mdc-never-here');
      await expect(fsp.writeFile(link, 'x')).rejects.toThrow(/test guard/);
      await expect(fsp.copyFile(import.meta.filename, link)).rejects.toThrow(/test guard/);
      await expect(fsp.cp(import.meta.filename, link)).rejects.toThrow(/test guard/);
      await fsp.rm(dir, { recursive: true, force: true });
    });

    it('still lets a test write, append and copy inside the temp dir, and write to a file handle', async () => {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-guard-'));
      const a = path.join(dir, 'a');
      await fsp.writeFile(a, 'x');
      await fsp.appendFile(a, 'y');
      await fsp.copyFile(a, path.join(dir, 'b'));
      fs.writeFileSync(path.join(dir, 'c'), 'z');
      const handle = await fsp.open(path.join(dir, 'd'), 'w');
      await fsp.writeFile(handle, 'h');
      await handle.close();
      expect((await fsp.readFile(path.join(dir, 'b'))).toString()).toBe('xy');
      expect((await fsp.readFile(path.join(dir, 'd'))).toString()).toBe('h');
      await fsp.rm(dir, { recursive: true, force: true });
    });

    it('refuses a Buffer path outside the temp dir', async () => {
      await expect(fsp.rm(Buffer.from('/usr/bin/mdc-never-here'), { force: true })).rejects.toThrow(
        /test guard/,
      );
    });

    it('refuses a Uint8Array path, which the kernel takes like a Buffer', async () => {
      // The typings call only a Buffer a path; the runtime takes any byte array.
      const asPath = (bytes: Uint8Array) => bytes as unknown as Buffer;
      const bytes = new Uint8Array(Buffer.from('/usr/bin/mdc-never-here'));
      await expect(fsp.rm(asPath(bytes), { force: true })).rejects.toThrow(/test guard/);
      expect(() => fs.unlinkSync(asPath(bytes))).toThrow(/test guard/);
      const padded = new Uint8Array(Buffer.from('xx/usr/bin/mdc-never-here'));
      expect(() => fs.rmSync(asPath(padded.subarray(2)))).toThrow(/test guard/);
      const inside = path.join(os.tmpdir(), 'mdc-guard-inside-bytes');
      const insideView = new Uint8Array(Buffer.from(`xx${inside}`)).subarray(2);
      await expect(fsp.rm(asPath(insideView), { force: true })).resolves.toBeUndefined();
      const trailing = `${inside}/../../../../../../usr/mdc-never-here`;
      const cut = new Uint8Array(Buffer.from(trailing)).subarray(0, inside.length);
      await expect(fsp.rm(asPath(cut), { force: true })).resolves.toBeUndefined();
    });

    it('does not loop on a symlink cycle', async () => {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-guard-'));
      await fsp.symlink(path.join(dir, 'b'), path.join(dir, 'a'));
      await fsp.symlink(path.join(dir, 'a'), path.join(dir, 'b'));
      await expect(fsp.truncate(path.join(dir, 'a'))).rejects.toThrow(/ELOOP/);
      await fsp.rm(dir, { recursive: true, force: true });
    });

    it('lets a test remove or move a symlink that points outside the temp dir', async () => {
      const { dir, link } = await linkTo('/usr/bin');
      await fsp.rename(link, path.join(dir, 'moved'));
      await fsp.unlink(path.join(dir, 'moved'));
      await fsp.symlink('/usr/bin', link);
      await fsp.rm(link);
      await expect(fsp.lstat(link)).rejects.toThrow();
      await fsp.rm(dir, { recursive: true, force: true });
    });

    it.each([
      ['the filesystem root', '/'],
      ['the home folder itself', fs.realpathSync(os.homedir())],
      ['the folder holding the home folder', path.dirname(fs.realpathSync(os.homedir()))],
    ])('refuses to start when the temp dir is %s', async (_name, tmp) => {
      vi.resetModules();
      const spy = vi.spyOn(os, 'tmpdir').mockReturnValue(tmp);
      try {
        await expect(import('../vitest.setup')).rejects.toThrow(/test guard/);
      } finally {
        spy.mockRestore();
      }
    });
  });
});

// The guard replaces each call it covers with an anonymous wrapper; every original has its own name.
describe('what the changelog and the setup comment say the guard covers', () => {
  const read = (name: string) =>
    fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8').replace(/\s+/g, ' ');
  const isGuarded = (fn: unknown) => typeof fn === 'function' && fn.name === '';
  const named = (text: string) => [...text.matchAll(/`(\w+)`/g)].map((m) => m[1]);
  const guarded = () =>
    Object.entries(fsp)
      .filter(([, fn]) => isGuarded(fn))
      .map(([name]) => name)
      .sort();
  const fsCalls = fs as unknown as Record<string, unknown>;

  const UNGUARDED = [
    'open',
    'createWriteStream',
    'chmod',
    'chown',
    'utimes',
    'link',
    'symlink',
    'mkdir',
    'mkdtemp',
    'ftruncate',
    'write',
    'writev',
  ];

  it('lists in the changelog exactly the calls the guard wraps', () => {
    const list =
      /Test runs refuse the Node file calls[^:]*:(.*?), in promise, callback and sync form/.exec(
        read('CHANGELOG.md'),
      )?.[1];
    expect(list).toBeDefined();
    expect(named(list ?? '').sort()).toEqual(guarded());
  });

  it('wraps the callback and sync forms of every guarded call too', () => {
    const missing = guarded().filter(
      (name) => !isGuarded(fsCalls[name]) || !isGuarded(fsCalls[`${name}Sync`]),
    );
    expect(missing).toEqual([]);
  });

  it.each(UNGUARDED)('says %s is not guarded, and it is not', (name) => {
    const notGuarded = /Not guarded: (.*?)\./.exec(read('CHANGELOG.md'))?.[1] ?? '';
    expect(isGuarded(fsCalls[name])).toBe(false);
    expect(named(notGuarded)).toContain(name);
    expect(/Not guarded: (.*?)\./.exec(read('vitest.setup.ts'))?.[1]).toContain(name);
  });
});
