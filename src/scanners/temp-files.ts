import os from 'node:os';
import type { CleanResult, ScanResult } from '../types.js';
import { run } from '../utils/exec.js';
import { getSize, pathExists, resolveDeletionTarget } from '../utils/fs.js';
import { BaseScanner } from './base-scanner.js';

export interface TempCandidate {
  path: string;
  label: string;
  description: string;
}

// /tmp is a one-segment symlink that assertSafeToDelete always refuses, so it is never offered.
export function tempCandidates(tmpDir: string): TempCandidate[] {
  return [
    {
      path: tmpDir,
      label: `TMPDIR (${tmpDir})`,
      description:
        'Deletes user-owned files older than 1 day; does not check whether a file is open',
    },
  ];
}

export class TempFilesScanner extends BaseScanner {
  readonly name = 'Temp Files';
  readonly category = 'temp-files';
  readonly description = 'Per-user temp dir (user-owned files older than 1 day)';
  readonly risk = 'moderate' as const;

  async scan(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    for (const c of tempCandidates(os.tmpdir())) {
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
    const user = process.env.USER ?? '';
    for (const r of results) {
      try {
        await resolveDeletionTarget(r.path);
        if (dryRun) {
          freed += r.size;
          continue;
        }
        const before = await getSize(r.path);
        const escaped = r.path.replace(/(["\\$`])/g, '\\$1');
        const filter = user ? `-user "${user}"` : '';
        const { code, stderr } = await run(
          `find "${escaped}" ${filter} -type f -mtime +1 -delete`,
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
