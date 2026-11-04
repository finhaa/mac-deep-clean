import path from 'node:path';
import type { CleanResult, ScanResult } from '../types.js';
import { commandExists, run } from '../utils/exec.js';
import { getSize, pathExists } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

const SIZE_MULTIPLIERS: Record<string, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
};

// Volumes are skipped: the prune below never removes them, so they are not reclaimable here.
export function reclaimableBytes(dfOutput: string): number {
  let total = 0;
  for (const line of dfOutput.split('\n')) {
    if (/^Local Volumes/i.test(line)) continue;
    const match = line.match(/(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)(?:\s*\(\d+%\))?\s*$/i);
    if (!match) continue;
    total += Number.parseFloat(match[1]!) * (SIZE_MULTIPLIERS[match[2]!.toUpperCase()] ?? 0);
  }
  return Math.round(total);
}

export class DockerScanner extends BaseScanner {
  readonly name = 'Docker';
  readonly category = 'docker';
  readonly description = 'Docker unused images, stopped containers, build cache (volumes are kept)';
  readonly risk = 'risky' as const;

  async scan(): Promise<ScanResult[]> {
    if (!(await commandExists('docker'))) return [];

    const results: ScanResult[] = [];
    const { stdout, code } = await run('docker system df --format "{{.Type}}\t{{.Reclaimable}}"', {
      timeout: 10_000,
    });

    if (code === 0 && stdout.trim()) {
      const total = reclaimableBytes(stdout);
      if (total > 0) {
        results.push({
          path: 'docker:system',
          size: total,
          label: 'Docker system (unused images, stopped containers, build cache)',
          category: this.category,
          risk: this.risk,
          description:
            'docker system prune -a -f — unused images, stopped containers, build cache. Volumes (databases) are kept.',
        });
      }
    }

    const vmPath = path.join(HOME, 'Library/Containers/com.docker.docker/Data/vms');
    if (await pathExists(vmPath)) {
      const size = await getSize(vmPath);
      if (size > 0) {
        results.push({
          path: vmPath,
          size,
          label: 'Docker VM disk (info only)',
          category: this.category,
          risk: this.risk,
          description:
            'Docker.raw only shrinks via Docker Desktop → Settings → Troubleshoot → Clean/Purge data. mac-deep-clean cannot reclaim this directly.',
          cleanable: false,
        });
      }
    }

    return results;
  }

  override async clean(results: ScanResult[], dryRun = false): Promise<CleanResult> {
    let freed = 0;
    const errors: string[] = [];

    for (const r of results) {
      if (r.path === 'docker:system') {
        if (!dryRun) {
          const { code, stderr } = await run('docker system prune -a -f', {
            timeout: 120_000,
          });
          if (code !== 0) {
            errors.push(`docker prune: ${stderr}`);
            continue;
          }
        }
        freed += r.size;
      } else {
        errors.push(
          `${r.path}: skipped — reset Docker Desktop VM via Docker Desktop app to reclaim`,
        );
      }
    }

    return { freed, errors };
  }
}
