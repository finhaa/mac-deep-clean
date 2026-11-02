import fs from 'node:fs/promises';
import path from 'node:path';
import type { ScanResult } from '../types.js';
import { run } from '../utils/exec.js';
import { getSize, isDirectory, pathExists } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

const SEARCH_ROOTS = [
  'code',
  'Code',
  'Projects',
  'projects',
  'Developer',
  'dev',
  'workspace',
  'repos',
  'Repos',
  'git',
  'src',
];

const ARTIFACT_DIRS = [
  'node_modules',
  '.next',
  '.nuxt',
  '.turbo',
  '.vite',
  '.svelte-kit',
  '.astro',
  '.angular',
  '.dart_tool',
  '.parcel-cache',
  'target',
  'Pods',
  '.venv',
  'venv',
  '__pycache__',
  '.tox',
  '.terraform',
  '.gradle',
];

const MAX_DEPTH = 5;

export class ProjectArtifactsScanner extends BaseScanner {
  readonly name = 'Project Build Artifacts';
  readonly category = 'project-artifacts';
  readonly description =
    'node_modules, .venv, target, Pods, .next and similar dirs across your project roots';
  readonly risk = 'moderate' as const;

  searchRoots: string[] | null = null;

  async scan(): Promise<ScanResult[]> {
    const roots = await this.resolveSearchRoots();
    if (roots.length === 0) return [];

    const namePattern = ARTIFACT_DIRS.map((n) => `-name "${n}"`).join(' -o ');
    const results: ScanResult[] = [];

    for (const root of roots) {
      const escaped = root.replace(/(["\\$`])/g, '\\$1');
      const cmd =
        `find "${escaped}" -maxdepth ${MAX_DEPTH} -type d ` +
        `\\( ${namePattern} \\) -prune -print 2>/dev/null`;
      const { stdout, code } = await run(cmd, { timeout: 60_000 });
      if (code !== 0 && !stdout.trim()) continue;

      for (const line of stdout.split('\n')) {
        const target = line.trim();
        if (!target) continue;
        if (await isInsideLinkedWorktree(target, root)) continue;
        if (!(await looksLikeBuildArtifact(target))) continue;
        const size = await getSize(target);
        if (size < 10 * 1024 * 1024) continue;
        const relative = path.relative(HOME, target);
        results.push({
          path: target,
          size,
          label: `~/${relative}`,
          category: this.category,
          risk: this.risk,
          description: 'Build artifact — rebuilds from source on next build',
        });
      }
    }

    return results.sort((a, b) => b.size - a.size);
  }

  private async resolveSearchRoots(): Promise<string[]> {
    if (this.searchRoots) return dedupeByRealpath(this.searchRoots);
    const found: string[] = [];
    for (const name of SEARCH_ROOTS) {
      const candidate = path.join(HOME, name);
      if (await isDirectory(candidate)) found.push(candidate);
    }
    return dedupeByRealpath(found);
  }
}

// Names too generic to trust alone: only a build artifact when its project file sits beside it.
const REQUIRED_SIBLINGS: Record<string, string[]> = {
  target: ['Cargo.toml', 'pom.xml', 'build.sbt'],
  Pods: ['Podfile'],
};

// Virtualenvs may hold packages that no requirements file records, so purge leaves them to a manual pick.
const NOT_CHECKED_BY_DEFAULT = new Set(['.venv', 'venv']);

export async function looksLikeBuildArtifact(target: string): Promise<boolean> {
  const markers = REQUIRED_SIBLINGS[path.basename(target)];
  if (!markers) return true;
  for (const marker of markers) {
    if (await pathExists(path.join(path.dirname(target), marker))) return true;
  }
  return false;
}

export function isCheckedByDefault(target: string): boolean {
  return !NOT_CHECKED_BY_DEFAULT.has(path.basename(target));
}

// A linked git worktree has a `.git` file; its dependencies belong to a live branch.
export async function isInsideLinkedWorktree(target: string, root: string): Promise<boolean> {
  let dir = path.dirname(target);
  while (dir !== root && dir !== path.dirname(dir)) {
    const st = await fs.lstat(path.join(dir, '.git')).catch(() => null);
    if (st?.isFile()) return true;
    dir = path.dirname(dir);
  }
  return false;
}

async function dedupeByRealpath(paths: string[]): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    try {
      const real = await fs.realpath(p);
      if (seen.has(real)) continue;
      seen.add(real);
      out.push(p);
    } catch {
      // skip
    }
  }
  return out;
}
