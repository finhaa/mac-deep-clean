// A test must never delete outside the OS temp dir: a safety guard that regresses while a test feeds it
// the real home or "/" would otherwise run a real recursive delete (it did, once, during a mutation run).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tmpRoots = [...new Set([os.tmpdir(), fs.realpathSync(os.tmpdir())])].map((p) =>
  path.resolve(p),
);

// $TMPDIR is trusted, so a root that is "/" or holds the home folder would make the guard allow everything.
const home = fs.realpathSync(os.homedir());
for (const root of tmpRoots) {
  if (root === path.parse(root).root || home === root || home.startsWith(root + path.sep)) {
    throw new Error(
      `test guard: the temp dir ${root} is the filesystem root or holds the home folder`,
    );
  }
}

// A folder as the kernel resolves it. A missing folder is appended to its nearest existing ancestor, which is
// resolved natively, never lexically: `link/missing/..` and `link/missing/x` lie wherever `link` points, and
// a recursive mkdir or cp creates `missing` there.
function kernelDir(dir: string): string {
  try {
    return fs.realpathSync.native(dir);
  } catch {}
  const up = path.dirname(dir);
  if (up === dir) return path.resolve(dir);
  return path.join(kernelDir(up), path.basename(dir));
}

// The path the kernel acts on. The parent is resolved natively, so a symlink inside the temp dir cannot lead a
// change outside it. The leaf is resolved too when the call follows it (truncate, writes) or when the string
// ends in "/", which makes the kernel follow a symlink there; otherwise it is left alone,
// because removing a symlink removes only the link. A symlink target is joined as a string, not resolved,
// so a `..` in it climbs from wherever the symlink before it points.
function kernelPath(raw: string, followLeaf: boolean, hops = 0): string {
  const parent = kernelDir(path.dirname(raw));
  const leaf = path.join(parent, path.basename(raw));
  if (!followLeaf && !raw.endsWith('/')) return leaf;
  try {
    return fs.realpathSync.native(leaf);
  } catch {}
  if (hops >= 40) return leaf;
  try {
    const target = fs.readlinkSync(leaf);
    return kernelPath(path.isAbsolute(target) ? target : `${parent}/${target}`, true, hops + 1);
  } catch {
    return leaf;
  }
}

// A string, a Buffer, any other byte array or a file: URL names a path; a file descriptor or a FileHandle does not.
// The guard covers only the calls in `guarded` below. Not guarded: the calls on a file descriptor or FileHandle
// (fchmod, fchown, futimes, ftruncate, write, writev; a descriptor opened for writing went through the guarded
// open, but fchmod, fchown and futimes also work on one opened for reading) and child processes. The checks run
// before the call, so a second hard link made between the check and the write is not caught.
function pathOf(arg: unknown): string | undefined {
  if (arg instanceof URL) return fileURLToPath(arg);
  if (ArrayBuffer.isView(arg))
    return Buffer.from(arg.buffer, arg.byteOffset, arg.byteLength).toString();
  return typeof arg === 'string' ? arg : undefined;
}

type Rule = {
  positions: number[];
  follow: boolean;
  inode?: boolean;
  when?: (args: unknown[]) => boolean;
};

// A path names a file, not its inode: a hard link inside the temp dir may share the inode with a file outside
// it, made before the run or by a child process, so a call that changes the file refuses one with other links.
function hardLinks(real: string): number {
  try {
    const stat = fs.lstatSync(real);
    return stat.isDirectory() ? 1 : stat.nlink;
  } catch {
    return 0;
  }
}

function assertInsideTmp(arg: unknown, { follow, inode }: Rule): void {
  const raw = pathOf(arg);
  if (raw === undefined) return;
  const real = kernelPath(raw, follow);
  if (!tmpRoots.some((root) => real.startsWith(root + path.sep))) {
    throw new Error(
      `test guard: refusing to change ${real}, tests may only change paths inside ${tmpRoots[0]}`,
    );
  }
  if (inode && hardLinks(real) > 1) {
    throw new Error(
      `test guard: refusing to change ${real}, another hard link to it may lie outside ${tmpRoots[0]}`,
    );
  }
}

const { O_WRONLY, O_RDWR, O_CREAT, O_TRUNC, O_APPEND } = fs.constants;
const opensForWriting = (args: unknown[]) =>
  typeof args[1] === 'number'
    ? (args[1] & (O_WRONLY | O_RDWR | O_CREAT | O_TRUNC | O_APPEND)) !== 0
    : typeof args[1] === 'string' && /[wa+]/.test(args[1]);

type Fn = (...args: unknown[]) => unknown;

// Argument positions that name a path the call deletes, moves, creates or changes. `follow` marks the calls
// that act on what a symlink there points to; the rest act on the link itself. `inode` marks the calls that
// change the file itself, which every hard link to it shares. `when` limits a rule to some calls.
const guarded: Record<string, Rule> = {
  rm: { positions: [0], follow: false },
  rmdir: { positions: [0], follow: false },
  unlink: { positions: [0], follow: false },
  rename: { positions: [0, 1], follow: false },
  truncate: { positions: [0], follow: true, inode: true },
  cp: { positions: [1], follow: true, inode: true },
  copyFile: { positions: [1], follow: true, inode: true },
  writeFile: { positions: [0], follow: true, inode: true },
  appendFile: { positions: [0], follow: true, inode: true },
  open: { positions: [0], follow: true, inode: true, when: opensForWriting },
  createWriteStream: { positions: [0], follow: true, inode: true },
  mkdir: { positions: [0], follow: false },
  mkdtemp: { positions: [0], follow: false },
  mkdtempDisposable: { positions: [0], follow: false },
  symlink: { positions: [1], follow: false },
  link: { positions: [0, 1], follow: true },
  utimes: { positions: [0], follow: true, inode: true },
  lutimes: { positions: [0], follow: false, inode: true },
  chmod: { positions: [0], follow: true, inode: true },
  lchmod: { positions: [0], follow: false, inode: true },
  chown: { positions: [0], follow: true, inode: true },
  lchown: { positions: [0], follow: false, inode: true },
};

// A form this Node lacks (fs.lchmod off macOS, mkdtempDisposable before Node 24, fsp.createWriteStream) is skipped.
function patch(target: object, name: string, rule: Rule, promise: boolean): void {
  const holder = target as Record<string, Fn>;
  const original = holder[name];
  if (typeof original !== 'function') return;
  const check = (args: unknown[]) => {
    if (rule.when && !rule.when(args)) return;
    for (const i of rule.positions) assertInsideTmp(args[i], rule);
  };
  holder[name] = promise
    ? async (...args) => {
        check(args);
        return original.apply(target, args);
      }
    : (...args) => {
        check(args);
        return original.apply(target, args);
      };
}

for (const [name, rule] of Object.entries(guarded)) {
  patch(fsp, name, rule, true);
  patch(fs, name, rule, false);
  patch(fs, `${name}Sync`, rule, false);
}

// Without this a named `import { rm } from 'node:fs/promises'` keeps the unguarded original.
syncBuiltinESMExports();
