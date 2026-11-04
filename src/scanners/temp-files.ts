import os from 'node:os';
import type { CleanResult, ScanResult } from '../types.js';
import { run, shellQuote } from '../utils/exec.js';
import { getSize, pathExists, resolveDeletionTarget } from '../utils/fs.js';
import { BaseScanner } from './base-scanner.js';

export interface TempCandidate {
  path: string;
  label: string;
  description: string;
}

// $TMPDIR is the user's to set, so only the macOS per-user temp dir is trusted as a deletion root.
const PER_USER_TEMP = /^(?:\/private)?\/var\/folders\/[^/]+\/[^/]+\/T\/?$/;

export function tempCandidates(tmpDir: string, trusted: RegExp = PER_USER_TEMP): TempCandidate[] {
  if (!trusted.test(tmpDir)) return [];
  return [
    {
      path: tmpDir,
      label: `TMPDIR (${tmpDir})`,
      description:
        'Frees at most this size: deletes user-owned files older than 1 day, and does not check whether a file is open',
    },
  ];
}

export class TempFilesScanner extends BaseScanner {
  readonly name = 'Temp Files';
  readonly category = 'temp-files';
  readonly description = 'Per-user temp dir (user-owned files older than 1 day)';
  readonly risk = 'moderate' as const;

  trustedTempRoot: RegExp = PER_USER_TEMP;

  async scan(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    for (const c of tempCandidates(os.tmpdir(), this.trustedTempRoot)) {
      if (!(await pathExists(c.path))) continue;
      const size = await getSize(c.path);
      if (size < 10 * 1024 * 1024) continue;
      results.push({
        path: c.path,
        size,
        label: c.label,
        category: this.category,
        risk: this.risk,
        description: c.description,
      });
    }
    return results;
  }

  override async clean(results: ScanResult[], dryRun = false): Promise<CleanResult> {
    let freed = 0;
    const errors: string[] = [];
    const user = os.userInfo().username;
    for (const r of results) {
      try {
        await resolveDeletionTarget(r.path);
        if (dryRun) {
          freed += r.size;
          continue;
        }
        const before = await getSize(r.path);
        const { code, stderr } = await run(
          `find ${shellQuote(r.path)} -user ${shellQuote(user)} -type f -mmin +1440 -delete`,
          { timeout: 60_000 },
        );
        if (code !== 0) {
          errors.push(`${r.path}: ${stderr.trim() || `find exited ${code}`}`);
          continue;
        }
        freed += Math.max(0, before - (await getSize(r.path)));
      } catch (err) {
        errors.push(`${r.path}: ${(err as Error).message}`);
      }
    }
    return { freed, errors };
  }
}
