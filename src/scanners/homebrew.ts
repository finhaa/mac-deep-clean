import type { CleanResult, ScanResult } from '../types.js';
import { asInvokingUser, run } from '../utils/exec.js';
import { BaseScanner } from './base-scanner.js';

export class HomebrewScanner extends BaseScanner {
  readonly name = 'Homebrew';
  readonly category = 'homebrew';
  readonly description = 'Homebrew downloads cache and old formula versions';
  readonly risk = 'safe' as const;

  async scan(): Promise<ScanResult[]> {
    const probe = await run(asInvokingUser('command -v brew'), { timeout: 3000 });
    if (probe.code !== 0) return [];
    const { stdout, code } = await run(asInvokingUser('brew --cache'), { timeout: 5000 });
    if (code !== 0) return [];
    const cachePath = stdout.trim();
    if (!cachePath) return [];
    const { getSize, pathExists } = await import('../utils/fs.js');
    if (!(await pathExists(cachePath))) return [];
    const size = await getSize(cachePath);
    if (size === 0) return [];
    return [
      {
        path: 'brew:cleanup',
        size,
        label: 'Homebrew cache & old versions',
        category: this.category,
        risk: this.risk,
        description: `brew cleanup -s (cache at ${cachePath})`,
      },
    ];
  }

  override async clean(results: ScanResult[], dryRun = false): Promise<CleanResult> {
    let freed = 0;
    const errors: string[] = [];
    for (const r of results) {
      if (dryRun) {
        freed += r.size;
        continue;
      }
      const { code, stderr } = await run(asInvokingUser('brew cleanup -s --prune=all'), {
        timeout: 120_000,
      });
      if (code !== 0) errors.push(`brew cleanup: ${stderr}`);
      else freed += r.size;
    }
    return { freed, errors };
  }
}
