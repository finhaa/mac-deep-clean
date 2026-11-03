import fs from 'node:fs/promises';
import path from 'node:path';
import type { CleanResult, ScanResult } from '../types.js';
import { run } from '../utils/exec.js';
import { HOME, assertSafeToDelete } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';
import { resolveSearchRoots } from './project-artifacts.js';

const MAX_DEPTH = 5;
const MIN_SIZE = 10 * 1024 * 1024;
const MIN_AGE_MS = 10 * 60_000;
const PACK_DIR = path.join('objects', 'pack');

// git writes a fetch into tmp_pack_* and renames it on success; an interrupted fetch leaves it behind.
function isTmpPackPath(file: string): boolean {
  if (!path.basename(file).startsWith('tmp_pack_')) return false;
  const packDir = path.dirname(file);
  return (
    packDir.endsWith(path.sep + PACK_DIR) &&
    path.basename(path.dirname(path.dirname(packDir))) === '.git'
  );
}

export class GitTmpPacksScanner extends BaseScanner {
  readonly name = 'Git Leaked Pack Files';
  readonly category = 'git-tmp-packs';
  readonly description =
    'tmp_pack_* files left in .git/objects/pack by interrupted fetches (untouched for 10+ minutes)';
  readonly risk = 'moderate' as const;

  searchRoots: string[] | null = null;

  async scan(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    for (const root of await resolveSearchRoots(this.searchRoots)) {
      const escaped = root.replace(/(["\\$`])/g, '\\$1');
      const { stdout } = await run(
        `find "${escaped}" -maxdepth ${MAX_DEPTH} -type d \\( -name node_modules -o -name .git \\) -prune -print 2>/dev/null`,
        { timeout: 60_000 },
      );
      for (const line of stdout.split('\n')) {
        const gitDir = line.trim();
        if (path.basename(gitDir) !== '.git') continue;
        results.push(...(await this.leaksIn(path.join(gitDir, PACK_DIR))));
      }
    }
    return results.sort((a, b) => b.size - a.size);
  }

  private async leaksIn(packDir: string): Promise<ScanResult[]> {
    const names = await fs.readdir(packDir).catch(() => []);
    const found: ScanResult[] = [];
    for (const name of names) {
      const file = path.join(packDir, name);
      if (!isTmpPackPath(file)) continue;
      const st = await fs.lstat(file).catch(() => null);
      if (!st?.isFile() || Date.now() - st.mtimeMs < MIN_AGE_MS || st.size < MIN_SIZE) continue;
      found.push({
        path: file,
        size: st.size,
        label: `~/${path.relative(HOME, file)}`,
        category: this.category,
        risk: this.risk,
        description: 'Half-written git download; git starts over on the next fetch',
      });
    }
    return found;
  }

  override async clean(results: ScanResult[], dryRun = false): Promise<CleanResult> {
    let freed = 0;
    const errors: string[] = [];
    for (const r of results) {
      try {
        assertSafeToDelete(r.path);
        if (!isTmpPackPath(r.path)) throw new Error('not a tmp_pack file in .git/objects/pack');
        const st = await fs.lstat(r.path).catch(() => null);
        if (!st?.isFile() || Date.now() - st.mtimeMs < MIN_AGE_MS) continue;
        if (!dryRun) await fs.rm(r.path);
        freed += r.size;
      } catch (err) {
        errors.push(`${r.path}: ${(err as Error).message}`);
      }
    }
    return { freed, errors };
  }
}
