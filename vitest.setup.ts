// A test must never delete outside the OS temp dir: a safety guard that regresses while a test feeds it
// the real home or "/" would otherwise run a real recursive delete (it did, once, during a mutation run).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const tmpRoots = [...new Set([os.tmpdir(), fs.realpathSync(os.tmpdir())])].map((p) =>
  path.resolve(p),
);

// The parent is resolved so a symlink inside the temp dir cannot lead a delete outside it; the leaf is
// left alone because removing a symlink removes only the link.
function realPath(target: string): string {
  const resolved = path.resolve(target);
  try {
    return path.join(fs.realpathSync(path.dirname(resolved)), path.basename(resolved));
  } catch {
    return resolved;
  }
}

function assertInsideTmp(target: unknown): void {
  const real = realPath(String(target));
  if (!tmpRoots.some((root) => real.startsWith(root + path.sep))) {
    throw new Error(
      `test guard: refusing to change ${real}, tests may only change paths inside ${tmpRoots[0]}`,
    );
  }
}

type Fn = (...args: unknown[]) => unknown;

// Argument positions that name a path the call deletes, overwrites or truncates.
const guarded: Record<string, number[]> = {
  rm: [0],
  rmdir: [0],
  unlink: [0],
  truncate: [0],
  cp: [1],
  rename: [0, 1],
};

function patch(target: object, name: string, positions: number[], promise: boolean): void {
  const holder = target as Record<string, Fn>;
  const original = holder[name] as Fn;
  holder[name] = promise
    ? async (...args) => {
        for (const i of positions) assertInsideTmp(args[i]);
        return original.apply(target, args);
      }
    : (...args) => {
        for (const i of positions) assertInsideTmp(args[i]);
        return original.apply(target, args);
      };
}

for (const [name, positions] of Object.entries(guarded)) {
  patch(fsp, name, positions, true);
  patch(fs, name, positions, false);
  patch(fs, `${name}Sync`, positions, false);
}

// Without this a named `import { rm } from 'node:fs/promises'` keeps the unguarded original.
syncBuiltinESMExports();
