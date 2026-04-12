import path from 'node:path';
import type { CleanResult, ScanResult } from '../types.js';
import { commandExists, run } from '../utils/exec.js';
import { getSize, pathExists } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

export class DockerScanner extends BaseScanner {
  readonly name = 'Docker';
  readonly category = 'docker';
  readonly description = 'Docker images, containers, volumes, build cache';
  readonly risk = 'risky' as const;

  async scan(): Promise<ScanResult[]> {
    if (!(await commandExists('docker'))) return [];

    const results: ScanResult[] = [];
    const { stdout, code } = await run(
      'docker system df --format "{{.Type}}\t{{.Size}}\t{{.Reclaimable}}"',
      { timeout: 10_000 },
    );

    if (code === 0 && stdout.trim()) {
      const total = await this.reclaimableBytes();
      if (total > 0) {
        results.push({
          path: 'docker:system',
          size: total,
          label: 'Docker system (images, containers, volumes, build cache)',
          category: this.category,
          risk: this.risk,
          description: 'docker system prune -a --volumes -f',
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
          label: 'Docker VM disk',
          category: this.category,
          risk: this.risk,
          description: 'Docker Desktop VM disk image (reset via Docker Desktop)',
        });
      }
    }

    return results;
  }

  private async reclaimableBytes(): Promise<number> {
    const { stdout, code } = await run('docker system df', { timeout: 10_000 });
    if (code !== 0) return 0;
    let total = 0;
    for (const line of stdout.split('\n')) {
      const match = line.match(/(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)\s*\((\d+)%\)/i);
      if (!match) continue;
      const value = Number.parseFloat(match[1]!);
      const unit = match[2]!.toUpperCase();
      const multipliers: Record<string, number> = {
        B: 1,
        KB: 1024,
        MB: 1024 ** 2,
        GB: 1024 ** 3,
        TB: 1024 ** 4,
      };
      total += value * (multipliers[unit] ?? 0);
    }
    return Math.round(total);
  }

  override async clean(results: ScanResult[], dryRun = false): Promise<CleanResult> {
    let freed = 0;
    const errors: string[] = [];

    for (const r of results) {
      if (r.path === 'docker:system') {
        if (!dryRun) {
          const { code, stderr } = await run('docker system prune -a --volumes -f', {
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
