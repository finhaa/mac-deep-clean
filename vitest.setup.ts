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

// The path the kernel acts on. The parent is resolved natively, so a symlink inside the temp dir cannot lead a
// change outside it. The leaf is resolved too when the call follows it (truncate, writes) or when the string
// ends in "/", which makes the kernel follow a symlink there; otherwise it is left alone,
// because removing a symlink removes only the link.
function kernelPath(raw: string, followLeaf: boolean, hops = 0): string {
  const name = path.basename(raw);
  let parent = path.resolve(path.dirname(raw));
  try {
    parent = fs.realpathSync.native(path.dirname(raw));
  } catch {}
  const leaf = path.join(parent, name);
  if (!followLeaf && !raw.endsWith('/')) return leaf;
  try {
    return fs.realpathSync.native(leaf);
  } catch {}
  if (hops >= 40) return leaf;
  try {
    return kernelPath(path.resolve(parent, fs.readlinkSync(leaf)), true, hops + 1);
  } catch {
    return leaf;
  }
}

// A string, a Buffer, any other byte array or a file: URL names a path; a file descriptor or a FileHandle does not.
// The guard covers only the calls in `guarded` below. Not guarded: open with a write flag, createWriteStream,
// chmod, chown and utimes (also their l forms), link, symlink, mkdir, mkdtemp, any call on a file descriptor or
// FileHandle (ftruncate, write, writev) and child processes.
function pathOf(arg: unknown): string | undefined {
  if (arg instanceof URL) return fileURLToPath(arg);
  if (ArrayBuffer.isView(arg))
    return Buffer.from(arg.buffer, arg.byteOffset, arg.byteLength).toString();
  return typeof arg === 'string' ? arg : undefined;
}

function assertInsideTmp(arg: unknown, followLeaf: boolean): void {
  const raw = pathOf(arg);
  if (raw === undefined) return;
  const real = kernelPath(raw, followLeaf);
  if (!tmpRoots.some((root) => real.startsWith(root + path.sep))) {
    throw new Error(
      `test guard: refusing to change ${real}, tests may only change paths inside ${tmpRoots[0]}`,
    );
  }
}

type Fn = (...args: unknown[]) => unknown;

// Argument positions that name a path the call deletes, overwrites or truncates. `follow` marks the calls
// that act on what a symlink there points to; the rest act on the link itself.
const guarded: Record<string, { positions: number[]; follow: boolean }> = {
  rm: { positions: [0], follow: false },
  rmdir: { positions: [0], follow: false },
  unlink: { positions: [0], follow: false },
  rename: { positions: [0, 1], follow: false },
  truncate: { positions: [0], follow: true },
  cp: { positions: [1], follow: true },
  copyFile: { positions: [1], follow: true },
  writeFile: { positions: [0], follow: true },
  appendFile: { positions: [0], follow: true },
};

function patch(
  target: object,
  name: string,
  { positions, follow }: { positions: number[]; follow: boolean },
  promise: boolean,
): void {
  const holder = target as Record<string, Fn>;
  const original = holder[name] as Fn;
  holder[name] = promise
    ? async (...args) => {
        for (const i of positions) assertInsideTmp(args[i], follow);
        return original.apply(target, args);
      }
    : (...args) => {
        for (const i of positions) assertInsideTmp(args[i], follow);
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
