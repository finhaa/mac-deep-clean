import fs from 'node:fs/promises';
import path from 'node:path';
import { assertSafeToDelete } from './paths.js';
import { run } from './exec.js';
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

export async function isDirectory(p: string): Promise<boolean> {
  try {
    const st = await fs.lstat(p);
    return st.isDirectory() && !st.isSymbolicLink();
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
  const escaped = p.replace(/(["\\$`])/g, '\\$1');
  const { stdout, stderr, code } = await run(`du -sk "${escaped}"`, {
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

export async function safeRemove(target: string): Promise<void> {
  assertSafeToDelete(target);
  if (!(await pathExists(target))) return;
  await fs.rm(target, { recursive: true, force: true });
}

/**
 * Remove contents of a directory but keep the directory itself.
 * Used for caches where we don't want to delete the parent dir.
 */
export async function clearDir(dir: string): Promise<void> {
  if (!(await isDirectory(dir))) return;
  const entries = await listDir(dir);
  for (const name of entries) {
    const child = path.join(dir, name);
    try {
      assertSafeToDelete(child);
      await fs.rm(child, { recursive: true, force: true });
    } catch {
      // skip
    }
  }
}
