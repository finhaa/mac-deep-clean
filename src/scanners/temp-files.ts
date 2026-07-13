import os from 'node:os';
import type { CleanResult, ScanResult } from '../types.js';
import { run } from '../utils/exec.js';
import { getSize, pathExists } from '../utils/fs.js';
import { assertSafeToDelete } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

export class TempFilesScanner extends BaseScanner {
  readonly name = 'Temp Files';
  readonly category = 'temp-files';
  readonly description = '/tmp and per-user temp dir (user-owned, >1 day old)';
  readonly risk = 'moderate' as const;

  async scan(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    const tmpDir = os.tmpdir();
    const candidates = [
      { path: '/tmp', label: '/tmp' },
      { path: tmpDir, label: `TMPDIR (${tmpDir})` },
    ];
    const seen = new Set<string>();
    for (const c of candidates) {
      if (seen.has(c.path)) continue;
      seen.add(c.path);
      if (!(await pathExists(c.path))) continue;
      const size = await getSize(c.path);
      if (size < 10 * 1024 * 1024) continue;
      results.push({
        path: c.path,
        size,
        label: c.label,
        category: this.category,
        risk: this.risk,
        description: 'Cleans user-owned files older than 1 day (leaves files in use)',
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
        assertSafeToDelete(r.path);
        if (dryRun) {
          freed += r.size;
          continue;
        }
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
        freed += r.size;
      } catch (err) {
        errors.push(`${r.path}: ${(err as Error).message}`);
      }
    }
    return { freed, errors };
  }
}
