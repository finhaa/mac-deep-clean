import fs from 'node:fs/promises';
import path from 'node:path';
import type { CleanResult, ScanResult } from '../types.js';
import { run, shellQuote } from '../utils/exec.js';
import { isDirectory, listDir, safeRemove } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

export class LaunchAgentsScanner extends BaseScanner {
  readonly name = 'Orphaned LaunchAgents';
  readonly category = 'launch-agents';
  readonly description = 'LaunchAgent plists whose target binary no longer exists';
  readonly risk = 'moderate' as const;

  async scan(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    const roots = [
      path.join(HOME, 'Library/LaunchAgents'),
      '/Library/LaunchAgents',
      '/Library/LaunchDaemons',
    ];

    for (const root of roots) {
      if (!(await isDirectory(root))) continue;
      for (const name of await listDir(root)) {
        if (!name.endsWith('.plist')) continue;
        const plistPath = path.join(root, name);
        const program = await readPlistProgram(plistPath);
        if (!program || !(await canJudgeProgram(program))) continue;
        if (await programResolves(program)) continue;
        const stat = await fs.lstat(plistPath).catch(() => null);
        const size = stat?.size ?? 0;
        results.push({
          path: plistPath,
          size,
          label: `${name} → ${program}`,
          category: this.category,
          risk: this.risk,
          description: `LaunchAgent whose target binary ${program} is missing`,
        });
      }
    }
    return results;
  }

  override async clean(results: ScanResult[], dryRun = false): Promise<CleanResult> {
    let freed = 0;
    const errors: string[] = [];
    for (const r of results) {
      try {
        if (!dryRun) {
          await bootOut(r.path);
          await safeRemove(r.path);
        }
        freed += r.size;
      } catch (err) {
        errors.push(`${r.path}: ${(err as Error).message}`);
      }
    }
    return { freed, errors };
  }
}

// Only a user agent can be unloaded without root; a job that is not loaded makes bootout fail, which is fine.
async function bootOut(plistPath: string): Promise<void> {
  if (!plistPath.startsWith(path.join(HOME, 'Library/LaunchAgents') + path.sep)) return;
  const uid = process.env.SUDO_UID ?? String(process.getuid?.() ?? '');
  if (!/^\d+$/.test(uid)) return;
  await run(`launchctl bootout gui/${uid} ${shellQuote(plistPath)}`, { timeout: 5000 });
}

// Only "no such file" proves a program is gone: a folder we may not enter hides it, it does not remove it.
async function mayExist(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code !== 'ENOENT' && code !== 'ENOTDIR';
  }
}

const LAUNCHD_PATH = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];

export async function programResolves(
  program: string,
  exists: (p: string) => Promise<boolean> = mayExist,
): Promise<boolean> {
  if (program.includes('/')) return exists(program);
  for (const dir of LAUNCHD_PATH) {
    if (await exists(path.join(dir, program))) return true;
  }
  return false;
}

// launchd resolves a relative path against its own working directory, and a program on an unmounted volume
// is not missing, only out of reach: neither is evidence of an orphan.
export async function canJudgeProgram(
  program: string,
  exists: (p: string) => Promise<boolean> = mayExist,
): Promise<boolean> {
  if (program.includes('/') && !path.isAbsolute(program)) return false;
  const volume = /^\/Volumes\/[^/]+/.exec(program)?.[0];
  return !volume || exists(volume);
}

async function readPlistProgram(plistPath: string): Promise<string | null> {
  const { stdout, code } = await run(
    `plutil -convert json -o - ${shellQuote(plistPath)} 2>/dev/null`,
    {
      timeout: 5000,
    },
  );
  if (code !== 0 || !stdout.trim()) return null;
  try {
    const data = JSON.parse(stdout) as {
      Program?: string;
      ProgramArguments?: string[];
    };
    if (typeof data.Program === 'string') return data.Program;
    if (Array.isArray(data.ProgramArguments) && data.ProgramArguments.length > 0) {
      const first = data.ProgramArguments[0];
      if (typeof first === 'string') return first;
    }
  } catch {
    return null;
  }
  return null;
}
