// A test must never delete outside the OS temp dir: a safety guard that regresses while a test feeds it
// the real home or "/" would otherwise run a real recursive delete (it did, once, during a mutation run).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const allowed = [...new Set([os.tmpdir(), fs.realpathSync(os.tmpdir())])].map((p) => path.resolve(p));

function assertInsideTmp(target: unknown): void {
  const resolved = path.resolve(String(target));
  const inside = allowed.some((root) => resolved === root || resolved.startsWith(root + path.sep));
  if (!inside) {
    throw new Error(`test guard: refusing to delete ${resolved}, tests may only delete inside ${allowed[0]}`);
  }
}

for (const name of ['rm', 'rmdir', 'unlink'] as const) {
  const original = fsp[name] as (...args: unknown[]) => Promise<unknown>;
  (fsp as unknown as Record<string, unknown>)[name] = async (target: unknown, ...rest: unknown[]) => {
    assertInsideTmp(target);
    return original.call(fsp, target, ...rest);
  };
}
for (const name of ['rmSync', 'rmdirSync', 'unlinkSync'] as const) {
  const original = fs[name] as (...args: unknown[]) => unknown;
  (fs as unknown as Record<string, unknown>)[name] = (target: unknown, ...rest: unknown[]) => {
    assertInsideTmp(target);
    return original.call(fs, target, ...rest);
  };
}
