import path from 'node:path';
import type { CleanResult, ScanResult } from '../types.js';
import { asInvokingUser, commandExists, run } from '../utils/exec.js';
import { getSize, pathExists } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

// Command Line Tools ship xcrun without simctl, so xcrun alone does not mean the cleanup can run. Without a
// developer folder /usr/bin/xcrun is a stub that can raise the tools install dialog, so it is not called.
async function simctlRuns(): Promise<boolean> {
  if (!(await commandExists('xcrun'))) return false;
  const developerDir = await run(asInvokingUser('xcode-select -p'), { timeout: 5000 });
  if (developerDir.code !== 0) return false;
  const { code } = await run(asInvokingUser('xcrun --find simctl'), { timeout: 10_000 });
  return code === 0;
}

export class IosSimulatorsScanner extends BaseScanner {
  readonly name = 'iOS Simulators & Xcode';
  readonly category = 'ios-simulators';
  readonly description = 'CoreSimulator devices, Xcode DerivedData and Archives';
  readonly risk = 'safe' as const;

  async scan(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];

    if (await simctlRuns()) {
      const devicesRoot = path.join(HOME, 'Library/Developer/CoreSimulator/Devices');
      if (await pathExists(devicesRoot)) {
        const size = await getSize(devicesRoot);
        if (size > 0) {
          results.push({
            path: 'xcrun:simctl:unavailable',
            size,
            label: 'Unavailable iOS simulators',
            category: this.category,
            risk: 'safe',
            description: 'xcrun simctl delete unavailable; frees at most this size',
          });
        }
      }
    }

    const derived = path.join(HOME, 'Library/Developer/Xcode/DerivedData');
    if (await pathExists(derived)) {
      const size = await getSize(derived);
      if (size > 0) {
        results.push({
          path: derived,
          size,
          label: 'Xcode DerivedData',
          category: this.category,
          risk: 'safe',
          description: 'Xcode build artifacts — regenerable',
        });
      }
    }

    const archives = path.join(HOME, 'Library/Developer/Xcode/Archives');
    if (await pathExists(archives)) {
      const size = await getSize(archives);
      if (size > 0) {
        results.push({
          path: archives,
          size,
          label: 'Xcode Archives',
          category: this.category,
          risk: 'moderate',
          irreversible: true,
          description: 'Xcode archived app builds',
        });
      }
    }

    return results;
  }

  override async clean(results: ScanResult[], dryRun = false): Promise<CleanResult> {
    let freed = 0;
    const errors: string[] = [];

    for (const r of results) {
      if (r.path === 'xcrun:simctl:unavailable') {
        if (!dryRun) {
          const { code, stderr } = await run(asInvokingUser('xcrun simctl delete unavailable'), {
            timeout: 60_000,
          });
          if (code !== 0) {
            errors.push(`simctl delete unavailable: ${stderr.trim()}`);
            continue;
          }
        }
        freed += r.size;
      } else {
        const res = await super.clean([r], dryRun);
        freed += res.freed;
        errors.push(...res.errors);
      }
    }
    return { freed, errors };
  }
}
