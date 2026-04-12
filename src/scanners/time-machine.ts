import type { CleanResult, ScanResult } from '../types.js';
import { commandExists, run } from '../utils/exec.js';
import { BaseScanner } from './base-scanner.js';

export class TimeMachineScanner extends BaseScanner {
  readonly name = 'Time Machine Local Snapshots';
  readonly category = 'time-machine';
  readonly description = 'Local Time Machine snapshots (needs sudo to delete)';
  readonly risk = 'moderate' as const;

  async scan(): Promise<ScanResult[]> {
    if (!(await commandExists('tmutil'))) return [];
    const { stdout, code } = await run('tmutil listlocalsnapshots /', { timeout: 10_000 });
    if (code !== 0) return [];
    const snapshots = stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('com.apple.TimeMachine.'));
    if (snapshots.length === 0) return [];

    return [
      {
        path: 'tmutil:snapshots',
        size: 0,
        label: `${snapshots.length} local Time Machine snapshot(s)`,
        category: this.category,
        risk: this.risk,
        description: 'sudo tmutil deletelocalsnapshots / (requires sudo)',
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
      const { stdout, code, stderr } = await run(
        'tmutil listlocalsnapshotdates / | tail -n +2',
        { timeout: 10_000 },
      );
      if (code !== 0) {
        errors.push(`tmutil list: ${stderr}`);
        continue;
      }
      const dates = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
      for (const date of dates) {
        const { code: delCode, stderr: delErr } = await run(
          `sudo tmutil deletelocalsnapshots ${date}`,
          { timeout: 60_000 },
        );
        if (delCode !== 0) {
          errors.push(`delete ${date}: ${delErr}`);
        }
      }
      freed += r.size;
    }
    return { freed, errors };
  }
}
