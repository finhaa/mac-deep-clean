import type { CleanResult, ScanResult } from '../types.js';
import { commandExists, run } from '../utils/exec.js';
import { BaseScanner } from './base-scanner.js';

const SNAPSHOT_NAME = /^com\.apple\.TimeMachine\.(\d{4}-\d{2}-\d{2}-\d{6})(?:\.local)?$/;
const ITEM_PATH = /^tmutil:snapshot:(\d{4}-\d{2}-\d{2}-\d{6})$/;

export class TimeMachineScanner extends BaseScanner {
  readonly name = 'Time Machine Local Snapshots';
  readonly category = 'time-machine';
  readonly description = 'Local Time Machine snapshots (needs sudo to delete)';
  readonly risk = 'moderate' as const;

  async scan(): Promise<ScanResult[]> {
    if (!(await commandExists('tmutil'))) return [];
    const { stdout, code } = await run('tmutil listlocalsnapshots /', { timeout: 10_000 });
    if (code !== 0) return [];
    const dates = stdout
      .split('\n')
      .map((line) => line.trim().match(SNAPSHOT_NAME)?.[1])
      .filter((date): date is string => date !== undefined);

    return [...new Set(dates)].map((date) => ({
      path: `tmutil:snapshot:${date}`,
      size: 0,
      virtual: true,
      label: `Time Machine local snapshot ${date}`,
      category: this.category,
      risk: this.risk,
      description: `sudo tmutil deletelocalsnapshots ${date} (requires sudo)`,
    }));
  }

  override async clean(results: ScanResult[], dryRun = false): Promise<CleanResult> {
    let freed = 0;
    const errors: string[] = [];
    for (const r of results) {
      const date = r.path.match(ITEM_PATH)?.[1];
      if (!date) {
        errors.push(`${r.path}: not a Time Machine snapshot`);
        continue;
      }
      if (dryRun) {
        freed += r.size;
        continue;
      }
      const { code, stderr } = await run(`sudo tmutil deletelocalsnapshots ${date}`, {
        timeout: 60_000,
      });
      if (code !== 0) {
        errors.push(`delete ${date}: ${stderr}`);
        continue;
      }
      freed += r.size;
    }
    return { freed, errors };
  }
}
