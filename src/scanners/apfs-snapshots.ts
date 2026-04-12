import type { CleanResult, ScanResult } from '../types.js';
import { commandExists, run } from '../utils/exec.js';
import { BaseScanner } from './base-scanner.js';

export class ApfsSnapshotsScanner extends BaseScanner {
  readonly name = 'APFS Snapshots';
  readonly category = 'apfs-snapshots';
  readonly description = 'APFS volume snapshots (requires sudo)';
  readonly risk = 'moderate' as const;

  async scan(): Promise<ScanResult[]> {
    if (!(await commandExists('diskutil'))) return [];
    const { stdout, code } = await run('diskutil apfs listSnapshots /', { timeout: 10_000 });
    if (code !== 0) return [];

    const uuids = this.parseUuids(stdout);
    if (uuids.length === 0) return [];

    return [
      {
        path: 'apfs:snapshots',
        size: 0,
        label: `${uuids.length} APFS snapshot(s) on /`,
        category: this.category,
        risk: this.risk,
        description: 'sudo diskutil apfs deleteSnapshot / -uuid <uuid> (requires sudo)',
      },
    ];
  }

  private parseUuids(output: string): string[] {
    const uuids: string[] = [];
    for (const line of output.split('\n')) {
      const match = line.match(/UUID:\s*([A-F0-9-]{36})/i);
      if (match) uuids.push(match[1]!);
    }
    return uuids;
  }

  override async clean(results: ScanResult[], dryRun = false): Promise<CleanResult> {
    let freed = 0;
    const errors: string[] = [];
    for (const r of results) {
      if (dryRun) {
        freed += r.size;
        continue;
      }
      const { stdout, code, stderr } = await run('diskutil apfs listSnapshots /', {
        timeout: 10_000,
      });
      if (code !== 0) {
        errors.push(`list snapshots: ${stderr}`);
        continue;
      }
      const uuids = this.parseUuids(stdout);
      for (const uuid of uuids) {
        const { code: delCode, stderr: delErr } = await run(
          `sudo diskutil apfs deleteSnapshot / -uuid ${uuid}`,
          { timeout: 60_000 },
        );
        if (delCode !== 0) errors.push(`delete ${uuid}: ${delErr}`);
      }
      freed += r.size;
    }
    return { freed, errors };
  }
}
