import fs from 'node:fs/promises';
import path from 'node:path';
import { run, shellQuote } from './exec.js';
import { assertSafeToDelete } from './paths.js';
import { addPermissionWarning } from './warnings.js';

const SIZE_TIMEOUT_MS = 30_000;

function isPermissionError(stderr: string): boolean {
  return /Operation not permitted|Permission denied/i.test(stderr);
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

// Removing an entry takes write and search permission on the folder that holds it.
export async function canWriteDir(dir: string): Promise<boolean> {
  try {
    await fs.access(dir, fs.constants.W_OK | fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function ownerUid(p: string): Promise<number | undefined> {
  try {
    return (await fs.lstat(p)).uid;
  } catch {
    return undefined;
  }
}

export async function isDirectory(p: string): Promise<boolean> {
  try {
    const st = await fs.lstat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Compute size in bytes. Uses `du -sk` with a 30s timeout to avoid hangs
 * on SIP-protected or very large directories. Returns 0 on failure.
 */
export async function getSize(p: string): Promise<number> {
  if (!(await pathExists(p))) return 0;
  try {
    const st = await fs.lstat(p);
    if (st.isSymbolicLink()) return 0;
    if (st.isFile()) return st.size;
  } catch {
    return 0;
  }
  const { stdout, stderr, code } = await run(`du -sk ${shellQuote(p)}`, {
    timeout: SIZE_TIMEOUT_MS,
  });
  if (code !== 0 && !stdout.trim()) {
    if (stderr && isPermissionError(stderr)) addPermissionWarning(p, 0);
    return 0;
  }
  const match = stdout.trim().split(/\s+/)[0];
  const kb = match ? Number.parseInt(match, 10) : 0;
  const bytes = Number.isFinite(kb) ? kb * 1024 : 0;
  if (stderr && isPermissionError(stderr)) addPermissionWarning(p, bytes);
  return bytes;
}

export async function listDir(p: string): Promise<string[]> {
  try {
    return await fs.readdir(p);
  } catch {
    return [];
  }
}

/**
 * Checks `target` and returns the path to delete, as the kernel spells it. The parent is resolved first,
 * so a symlinked parent component cannot lead a lexically safe path into a protected one. A leaf that is
 * not a symlink is resolved too, so the guard compares the folder the volume really names, not a case or
 * Unicode spelling of it; a symlink leaf is left alone because removing a symlink removes only the link.
 */
export async function resolveDeletionTarget(target: string): Promise<string> {
  assertSafeToDelete(target);
  const resolved = path.resolve(target);
  const parent = await fs.realpath(path.dirname(resolved)).catch(() => null);
  if (!parent) return resolved;
  const real = await resolveLeaf(path.join(parent, path.basename(resolved)));
  assertSafeToDelete(real);
  return real;
}

/**
 * The real path of a leaf that is not a symlink, or the leaf itself when it is one or is gone. A leaf
 * swapped between the lstat and the realpath would send the delete to wherever the swap points, so the
 * real path must name the inode the lstat saw.
 */
async function resolveLeaf(leaf: string): Promise<string> {
  const seen = await fs.lstat(leaf, { bigint: true }).catch(() => null);
  if (!seen || seen.isSymbolicLink()) return leaf;
  const real = await fs.realpath(leaf).catch(() => leaf);
  const now = await fs.lstat(real, { bigint: true }).catch(() => null);
  if (now && (now.dev !== seen.dev || now.ino !== seen.ino)) {
    throw new Error(`Refusing to delete ${leaf}: it changed while it was being checked`);
  }
  return real;
}

export async function safeRemove(target: string): Promise<void> {
  const real = await resolveDeletionTarget(target);
  if (!(await pathExists(real))) return;
  await fs.rm(real, { recursive: true, force: true });
}

/**
 * Remove the contents of a directory but keep the directory itself and any child named in `keep`.
 * `freed` counts only children that are really gone; every other child adds a message to `errors`.
 */
export async function clearDir(
  dir: string,
  keep: readonly string[] = [],
): Promise<{ freed: number; errors: string[] }> {
  let freed = 0;
  const errors: string[] = [];
  if (!(await isDirectory(dir))) return { freed, errors };
  for (const name of await listDir(dir)) {
    if (keep.includes(name)) continue;
    const child = path.join(dir, name);
    const size = await getSize(child);
    try {
      const real = await resolveDeletionTarget(child);
      await fs.rm(real, { recursive: true, force: true });
    } catch (err) {
      errors.push(`${child}: ${(err as Error).message}`);
      continue;
    }
    if (await pathExists(child)) errors.push(`${child}: still exists after removal`);
    else freed += size;
  }
  return { freed, errors };
}

/** Bytes under `dir`, leaving out the children named in `keep`. */
export async function sizeExcluding(dir: string, keep: readonly string[]): Promise<number> {
  let total = 0;
  for (const name of await listDir(dir)) {
    if (!keep.includes(name)) total += await getSize(path.join(dir, name));
  }
  return total;
}
