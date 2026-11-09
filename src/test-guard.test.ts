import fs, { rmSync as namedRmSync } from 'node:fs';
import fsp, { rm as namedRm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const never = (base: string) => path.join(base, 'mdc-never-here');
const outside = ['/usr/bin', os.homedir()];

// A red run must not leak its temp dirs: afterEach runs when the test body throws.
const made: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-guard-'));
  made.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of made.splice(0)) await fsp.rm(dir, { recursive: true, force: true });
});

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
    const dir = await tempDir();
    const link = path.join(dir, 'link');
    await fsp.symlink(os.homedir(), link);
    await expect(fsp.rm(path.join(link, 'mdc-never-here'), { force: true })).rejects.toThrow(
      /test guard/,
    );
    expect(() => fs.rmSync(path.join(link, 'mdc-never-here'), { force: true })).toThrow(
      /test guard/,
    );
  });

  it('still lets a test remove the symlink itself, which removes only the link', async () => {
    const dir = await tempDir();
    const target = path.join(dir, 'target');
    await fsp.mkdir(target);
    await fsp.symlink(target, path.join(dir, 'link'));
    await fsp.rm(path.join(dir, 'link'));
    await expect(fsp.stat(target)).resolves.toBeDefined();
  });

  it('still deletes, copies, renames and truncates inside the temp dir', async () => {
    const dir = await tempDir();
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
      const dir = await tempDir();
      const link = path.join(dir, 'link');
      await fsp.symlink(target, link);
      return { dir, link };
    }

    it('refuses a trailing slash on a symlink in the temp dir that points outside it', async () => {
      const { link } = await linkTo('/usr/bin');
      await expect(fsp.rm(`${link}/`)).rejects.toThrow(/test guard/);
      await expect(fsp.rmdir(`${link}/`)).rejects.toThrow(/test guard/);
      expect(() => fs.rmSync(`${link}/`)).toThrow(/test guard/);
      expect(() => fs.rmSync(`${link}/.`)).toThrow(/test guard/);
    });

    it('refuses to truncate through a symlink in the temp dir that points outside it', async () => {
      const { link } = await linkTo('/usr/bin/mdc-never-here');
      await expect(fsp.truncate(link)).rejects.toThrow(/test guard/);
      expect(() => fs.truncateSync(link)).toThrow(/test guard/);
    });

    it('refuses a file: URL outside the temp dir, whatever the working directory', async () => {
      const url = pathToFileURL('/usr/bin/mdc-never-here');
      await expect(fsp.rm(url, { force: true })).rejects.toThrow(/test guard/);
      expect(() => fs.rmSync(url, { force: true })).toThrow(/test guard/);
    });

    // Node takes any object shaped like a URL, not only a URL instance.
    it('refuses a plain object shaped like a file: URL outside the temp dir', async () => {
      const target = '/usr/bin/mdc-never-here';
      const like = { href: `file://${target}`, protocol: 'file:', hostname: '', pathname: target };
      const asUrl = (obj: object) => obj as URL;
      await expect(fsp.rm(asUrl(like), { force: true })).rejects.toThrow(/test guard/);
      expect(() => fs.rmSync(asUrl(like), { force: true })).toThrow(/test guard/);
      expect(() => fs.writeFileSync(asUrl(like), 'x')).toThrow(/test guard/);
      const dir = await tempDir();
      const file = path.join(dir, 'f');
      await fsp.writeFile(file, 'x');
      await fsp.rm(asUrl({ ...like, href: `file://${file}`, pathname: file }));
      await expect(fsp.stat(file)).rejects.toThrow();
    });

    it('still accepts a file: URL inside the temp dir', async () => {
      const dir = await tempDir();
      const file = path.join(dir, 'f');
      await fsp.writeFile(file, 'x');
      await fsp.rm(pathToFileURL(file));
      await expect(fsp.stat(file)).rejects.toThrow();
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
      const { link } = await linkTo('/usr/bin/mdc-never-here');
      await expect(fsp.writeFile(link, 'x')).rejects.toThrow(/test guard/);
      await expect(fsp.copyFile(import.meta.filename, link)).rejects.toThrow(/test guard/);
      await expect(fsp.cp(import.meta.filename, link)).rejects.toThrow(/test guard/);
    });

    it('still lets a test write, append and copy inside the temp dir, and write to a file handle', async () => {
      const dir = await tempDir();
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
      const dir = await tempDir();
      await fsp.symlink(path.join(dir, 'b'), path.join(dir, 'a'));
      await fsp.symlink(path.join(dir, 'a'), path.join(dir, 'b'));
      await expect(fsp.truncate(path.join(dir, 'a'))).rejects.toThrow(/ELOOP/);
    });

    it('lets a test remove or move a symlink that points outside the temp dir', async () => {
      const { dir, link } = await linkTo('/usr/bin');
      await fsp.rename(link, path.join(dir, 'moved'));
      await fsp.unlink(path.join(dir, 'moved'));
      await fsp.symlink('/usr/bin', link);
      await fsp.rm(link);
      await expect(fsp.lstat(link)).rejects.toThrow();
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

  // Under /usr/bin only: a regressed guard that let a create through would make it in the home folder.
  describe('refuses to create or change anything outside the temp dir', () => {
    const target = never('/usr/bin');
    const { O_WRONLY, O_RDWR, O_CREAT, O_TRUNC, O_APPEND } = fs.constants;

    it('mkdir and mkdtemp, in every flavour', async () => {
      await expect(fsp.mkdir(target)).rejects.toThrow(/test guard/);
      await expect(fsp.mkdir(path.join(target, 'x'), { recursive: true })).rejects.toThrow(
        /test guard/,
      );
      expect(() => fs.mkdirSync(target)).toThrow(/test guard/);
      expect(() => fs.mkdir(target, () => {})).toThrow(/test guard/);
      await expect(fsp.mkdtemp(`${target}-`)).rejects.toThrow(/test guard/);
      expect(() => fs.mkdtempSync(`${target}-`)).toThrow(/test guard/);
      expect(() => fs.mkdtemp(`${target}-`, () => {})).toThrow(/test guard/);
    });

    it('symlink and link, in every flavour', async () => {
      const dir = await tempDir();
      const file = path.join(dir, 'f');
      await fsp.writeFile(file, 'x');
      await expect(fsp.symlink('/usr/bin', target)).rejects.toThrow(/test guard/);
      expect(() => fs.symlinkSync('/usr/bin', target)).toThrow(/test guard/);
      expect(() => fs.symlink('/usr/bin', target, () => {})).toThrow(/test guard/);
      await expect(fsp.link(file, target)).rejects.toThrow(/test guard/);
      expect(() => fs.linkSync(file, target)).toThrow(/test guard/);
      expect(() => fs.link(file, target, () => {})).toThrow(/test guard/);
    });

    it('a hard link in the temp dir to a file outside it, which a write would change', async () => {
      const dir = await tempDir();
      const alias = path.join(dir, 'alias');
      await expect(fsp.link('/usr/bin/true', alias)).rejects.toThrow(/test guard/);
      expect(() => fs.linkSync('/usr/bin/true', alias)).toThrow(/test guard/);
      expect(() => fs.link('/usr/bin/true', alias, () => {})).toThrow(/test guard/);
    });

    it('utimes, chmod and chown and their l forms, in every flavour', async () => {
      for (const name of ['utimes', 'lutimes', 'chmod', 'lchmod', 'chown', 'lchown'] as const) {
        const args = name.endsWith('utimes') ? [1, 1] : name.endsWith('chmod') ? [0o644] : [0, 0];
        const call = (fn: unknown, ...rest: unknown[]) =>
          (fn as (...a: unknown[]) => unknown)(target, ...args, ...rest);
        await expect(call(fsp[name])).rejects.toThrow(/test guard/);
        // fs.lchmod exists only on macOS.
        if (fs[name] === undefined) continue;
        expect(() => call(fs[`${name}Sync`])).toThrow(/test guard/);
        expect(() => call(fs[name], () => {})).toThrow(/test guard/);
      }
    });

    it.each([
      ['w'],
      ['a'],
      ['r+'],
      ['wx'],
      [O_WRONLY | O_CREAT],
      [O_WRONLY],
      [O_RDWR],
      [O_CREAT],
      [O_TRUNC],
      [O_APPEND],
    ])('open with the write flag %s, in every flavour', async (flags) => {
      await expect(fsp.open(target, flags)).rejects.toThrow(/test guard/);
      expect(() => fs.openSync(target, flags)).toThrow(/test guard/);
      expect(() => fs.open(target, flags, () => {})).toThrow(/test guard/);
    });

    it('createWriteStream, and a WriteStream built directly', async () => {
      expect(() => fs.createWriteStream(target)).toThrow(/test guard/);
      // The typings hide the path argument that the runtime constructor takes.
      const WriteStream = fs.WriteStream as unknown as new (p: string) => fs.WriteStream;
      const stream = new WriteStream(target);
      await expect(new Promise((_resolve, reject) => stream.on('error', reject))).rejects.toThrow(
        /test guard/,
      );
    });

    it('refuses to change through a symlink in the temp dir that points outside it', async () => {
      const dir = await tempDir();
      const link = path.join(dir, 'link');
      await fsp.symlink(target, link);
      await expect(fsp.utimes(link, 1, 1)).rejects.toThrow(/test guard/);
      await expect(fsp.chmod(link, 0o644)).rejects.toThrow(/test guard/);
      await expect(fsp.chown(link, 0, 0)).rejects.toThrow(/test guard/);
      await expect(fsp.open(link, 'w')).rejects.toThrow(/test guard/);
      expect(() => fs.createWriteStream(link)).toThrow(/test guard/);
      await expect(fsp.link(link, path.join(dir, 'alias'))).rejects.toThrow(/test guard/);
    });

    it('still opens a file outside the temp dir for reading', async () => {
      const handle = await fsp.open(import.meta.filename);
      await handle.close();
      fs.closeSync(fs.openSync(import.meta.filename, 'r'));
      fs.closeSync(fs.openSync(import.meta.filename, fs.constants.O_RDONLY));
      await new Promise((resolve) =>
        fs.open(import.meta.filename, (_e, fd) => fs.close(fd, resolve)),
      );
    });

    it('refuses a change under a symlink in the temp dir whose next folder does not exist', async () => {
      const dir = await tempDir();
      const link = path.join(dir, 'link');
      await fsp.symlink('/usr/bin', link);
      const src = path.join(dir, 'src');
      await fsp.writeFile(src, 'x');
      await expect(fsp.cp(src, path.join(link, 'mdc-no-such-dir', 'x'))).rejects.toThrow(
        /test guard/,
      );
      expect(() => fs.cpSync(src, path.join(link, 'mdc-no-such-dir', 'y'))).toThrow(/test guard/);
      await expect(
        fsp.mkdir(path.join(link, 'mdc-no-such-dir', 'z'), { recursive: true }),
      ).rejects.toThrow(/test guard/);
      await expect(
        fsp.rm(path.join(link, 'mdc-no-such-dir', 'x'), { force: true }),
      ).rejects.toThrow(/test guard/);
    });

    // The string is built by hand: path.join would collapse `missing/..` before the guard sees it.
    it('refuses a recursive create whose `..` after a missing folder leads into a symlink out', async () => {
      const dir = await tempDir();
      await fsp.symlink('/usr/bin', path.join(dir, 'link'));
      const src = path.join(dir, 'src');
      await fsp.writeFile(src, 'x');
      const climbing = `${dir}/mdc-missing/../link/mdc-never-here`;
      await expect(fsp.mkdir(climbing, { recursive: true })).rejects.toThrow(/test guard/);
      expect(() => fs.mkdirSync(climbing, { recursive: true })).toThrow(/test guard/);
      expect(() => fs.mkdir(climbing, { recursive: true }, () => {})).toThrow(/test guard/);
      await expect(fsp.cp(src, climbing)).rejects.toThrow(/test guard/);
      expect(() => fs.cpSync(src, climbing)).toThrow(/test guard/);
      await expect(fsp.stat(path.join(dir, 'mdc-missing'))).rejects.toThrow(/ENOENT/);
    });

    it('still creates a folder whose `..` follows a folder that exists', async () => {
      const dir = await tempDir();
      await fsp.mkdir(path.join(dir, 'a'));
      await fsp.mkdir(`${dir}/a/../b/c`, { recursive: true });
      await expect(fsp.stat(path.join(dir, 'b', 'c'))).resolves.toBeDefined();
    });

    // From Node 22 cpSync copies a folder in native code, past the guarded calls, and writes through what it finds.
    it('refuses a recursive cp into a folder that holds a symlink or a hard-linked file', async () => {
      const dir = await tempDir();
      const src = path.join(dir, 'src');
      await fsp.mkdir(path.join(src, 'sub'), { recursive: true });
      await fsp.writeFile(path.join(src, 'sub', 'a'), 'new');
      const linked = path.join(dir, 'linked');
      await fsp.mkdir(path.join(linked, 'sub'), { recursive: true });
      await fsp.symlink('/usr/bin/mdc-never-here', path.join(linked, 'sub', 'a'));
      await expect(fsp.cp(src, linked, { recursive: true })).rejects.toThrow(/test guard/);
      expect(() => fs.cpSync(src, linked, { recursive: true })).toThrow(/test guard/);
      expect(() => fs.cp(src, linked, { recursive: true }, () => {})).toThrow(/test guard/);
      const twinned = path.join(dir, 'twinned');
      await fsp.mkdir(path.join(twinned, 'sub'), { recursive: true });
      await fsp.writeFile(path.join(twinned, 'sub', 'a'), 'old');
      await fsp.link(path.join(twinned, 'sub', 'a'), path.join(dir, 'twin'));
      expect(() => fs.cpSync(src, twinned, { recursive: true })).toThrow(/test guard/);
      expect((await fsp.readFile(path.join(dir, 'twin'))).toString()).toBe('old');
    });

    it.skipIf(process.getuid?.() === 0)(
      'refuses a recursive cp into a folder that holds a folder it cannot read',
      async () => {
        const dir = await tempDir();
        const src = path.join(dir, 'src');
        await fsp.mkdir(path.join(src, 'sub'), { recursive: true });
        await fsp.writeFile(path.join(src, 'sub', 'a'), 'new');
        const locked = path.join(dir, 'locked');
        await fsp.mkdir(path.join(locked, 'sub'), { recursive: true });
        await fsp.symlink('/usr/bin/mdc-never-here', path.join(locked, 'sub', 'a'));
        await fsp.chmod(path.join(locked, 'sub'), 0o300);
        try {
          await expect(fsp.cp(src, locked, { recursive: true })).rejects.toThrow(/test guard/);
          expect(() => fs.cpSync(src, locked, { recursive: true })).toThrow(/test guard/);
        } finally {
          await fsp.chmod(path.join(locked, 'sub'), 0o755);
        }
      },
    );

    it('still copies a folder into a new folder or over one that holds only plain files, and a file over a file', async () => {
      const dir = await tempDir();
      const src = path.join(dir, 'src');
      await fsp.mkdir(path.join(src, 'sub'), { recursive: true });
      await fsp.writeFile(path.join(src, 'sub', 'a'), 'new');
      await fsp.symlink('/usr/bin', path.join(src, 'outward'));
      await fsp.cp(src, path.join(dir, 'fresh'), { recursive: true });
      const plain = path.join(dir, 'plain');
      await fsp.mkdir(path.join(plain, 'sub'), { recursive: true });
      await fsp.writeFile(path.join(plain, 'sub', 'a'), 'old');
      fs.cpSync(src, plain, { recursive: true });
      expect((await fsp.readFile(path.join(dir, 'fresh', 'sub', 'a'))).toString()).toBe('new');
      expect((await fsp.readFile(path.join(plain, 'sub', 'a'))).toString()).toBe('new');
      const single = path.join(dir, 'single');
      await fsp.writeFile(single, 'old');
      await fsp.cp(path.join(src, 'sub', 'a'), single);
      expect((await fsp.readFile(single)).toString()).toBe('new');
    });

    it('refuses a symlink whose target climbs out through another symlink', async () => {
      const dir = await tempDir();
      await fsp.symlink('/usr/bin', path.join(dir, 'bin'));
      const climbing = path.join(dir, 'climbing');
      await fsp.symlink(`${dir}/bin/../mdc-never-here`, climbing);
      await expect(fsp.truncate(climbing)).rejects.toThrow(/test guard/);
      await fsp.symlink('bin/../mdc-never-here', path.join(dir, 'relative'));
      await expect(fsp.truncate(path.join(dir, 'relative'))).rejects.toThrow(/test guard/);
    });

    it('refuses to change a file in the temp dir that another hard link shares', async () => {
      const dir = await tempDir();
      const file = path.join(dir, 'f');
      await fsp.writeFile(file, 'x');
      await fsp.link(file, path.join(dir, 'twin'));
      await expect(fsp.writeFile(file, 'y')).rejects.toThrow(/test guard/);
      await expect(fsp.appendFile(file, 'y')).rejects.toThrow(/test guard/);
      await expect(fsp.truncate(file)).rejects.toThrow(/test guard/);
      await expect(fsp.copyFile(import.meta.filename, file)).rejects.toThrow(/test guard/);
      await expect(fsp.cp(import.meta.filename, file)).rejects.toThrow(/test guard/);
      await expect(fsp.open(file, 'r+')).rejects.toThrow(/test guard/);
      expect(() => fs.createWriteStream(file)).toThrow(/test guard/);
      await expect(fsp.utimes(file, 1, 1)).rejects.toThrow(/test guard/);
      await expect(fsp.lutimes(file, 1, 1)).rejects.toThrow(/test guard/);
      await expect(fsp.chmod(file, 0o600)).rejects.toThrow(/test guard/);
      await expect(
        fsp.lchown(file, process.getuid?.() ?? 0, process.getgid?.() ?? 0),
      ).rejects.toThrow(/test guard/);
      await expect(
        fsp.chown(file, process.getuid?.() ?? 0, process.getgid?.() ?? 0),
      ).rejects.toThrow(/test guard/);
      if (fs.lchmod !== undefined)
        await expect(fsp.lchmod(file, 0o600)).rejects.toThrow(/test guard/);
      expect((await fsp.readFile(path.join(dir, 'twin'))).toString()).toBe('x');
      await fsp.unlink(path.join(dir, 'twin'));
      await fsp.writeFile(file, 'y');
      expect((await fsp.readFile(file)).toString()).toBe('y');
    });

    it('still lets a test create, link, open for writing and change metadata inside the temp dir', async () => {
      const dir = await tempDir();
      await fsp.mkdir(path.join(dir, 'a', 'b'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'c'));
      const inner = await fsp.mkdtemp(path.join(dir, 'm-'));
      expect(fs.mkdtempSync(path.join(dir, 'm-')).startsWith(path.join(dir, 'm-'))).toBe(true);
      const file = path.join(inner, 'f');
      const handle = await fsp.open(file, 'w');
      await handle.writeFile('x');
      await handle.close();
      fs.closeSync(fs.openSync(file, 'a'));
      await new Promise<void>((resolve, reject) =>
        fs
          .createWriteStream(path.join(dir, 's'))
          .end('s', () => resolve())
          .on('error', reject),
      );
      await fsp.symlink('/usr/bin', path.join(dir, 'outward'));
      fs.symlinkSync(file, path.join(dir, 'inward'));
      await fsp.link(file, path.join(dir, 'twin'));
      await fsp.unlink(path.join(dir, 'twin'));
      await fsp.utimes(file, 1, 1);
      await fsp.lutimes(path.join(dir, 'outward'), 1, 1);
      await fsp.chmod(file, 0o600);
      await fsp.chown(file, process.getuid?.() ?? 0, process.getgid?.() ?? 0);
      await fsp.lchown(path.join(dir, 'outward'), process.getuid?.() ?? 0, process.getgid?.() ?? 0);
      if (fs.lchmod !== undefined) await fsp.lchmod(path.join(dir, 'outward'), 0o700);
      // A folder always has more than one link, its own `.` and each subfolder's `..`.
      await fsp.chmod(dir, 0o700);
      await fsp.utimes(dir, 1, 1);
      expect((await fsp.stat(file)).mode & 0o777).toBe(0o600);
      expect((await fsp.readFile(path.join(dir, 's'))).toString()).toBe('s');
      expect((await fsp.stat('/usr/bin')).isDirectory()).toBe(true);
    });
  });

  describe('removes the temp dirs a test made, even when it fails', () => {
    let left = '';
    it('makes a temp dir', async () => {
      left = await tempDir();
      await expect(fsp.stat(left)).resolves.toBeDefined();
    });

    it('finds it gone in the next test', async () => {
      expect(left).not.toBe('');
      await expect(fsp.stat(left)).rejects.toThrow(/ENOENT/);
    });
  });
});

// The guard replaces each call it covers with an anonymous wrapper; every original has its own name.
describe('what the changelog and the setup comment say the guard covers', () => {
  const read = (name: string) =>
    fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8').replace(/\s+/g, ' ');
  const isGuarded = (fn: unknown) => typeof fn === 'function' && fn.name === '';
  const named = (text: string) => [...text.matchAll(/`(\w+)`/g)].map((m) => m[1] ?? '');
  const fsCalls = fs as unknown as Record<string, unknown>;
  const fspCalls = fsp as unknown as Record<string, unknown>;
  // A call counts once, by its promise and callback name; some exist only as a callback or only on some Node versions.
  const guarded = () =>
    [
      ...new Set(
        [...Object.entries(fsp), ...Object.entries(fs)]
          .filter(([, fn]) => isGuarded(fn))
          .map(([name]) => name.replace(/Sync$/, '')),
      ),
    ].sort();
  const forms = (name: string) =>
    [fspCalls[name], fsCalls[name], fsCalls[`${name}Sync`]].filter((fn) => fn !== undefined);

  const UNGUARDED = ['fchmod', 'fchown', 'futimes', 'ftruncate', 'write', 'writev'];

  it('lists in the changelog exactly the calls the guard wraps', () => {
    const list =
      /Test runs refuse the Node file calls[^:]*:(.*?), in promise, callback and sync form/.exec(
        read('CHANGELOG.md'),
      )?.[1];
    expect(list).toBeDefined();
    const onThisNode = named(list ?? '').filter((name) => forms(name).length > 0);
    expect(onThisNode.sort()).toEqual(guarded());
  });

  it('wraps the promise, callback and sync forms of every guarded call that Node has', () => {
    const missing = guarded().filter((name) => !forms(name).every(isGuarded));
    expect(missing).toEqual([]);
    for (const name of ['rm', 'open', 'mkdir', 'link', 'utimes']) {
      expect(forms(name).filter(isGuarded)).toHaveLength(3);
    }
    expect(fspCalls.createWriteStream).toBeUndefined();
    expect(fsCalls.createWriteStreamSync).toBeUndefined();
  });

  it.each(UNGUARDED)('says %s is not guarded, and it is not', (name) => {
    const notGuarded = /Not guarded: (.*?)\./.exec(read('CHANGELOG.md'))?.[1] ?? '';
    expect(isGuarded(fsCalls[name])).toBe(false);
    expect(named(notGuarded)).toContain(name);
    expect(/Not guarded: (.*?)\./.exec(read('vitest.setup.ts'))?.[1]).toContain(name);
  });
});
