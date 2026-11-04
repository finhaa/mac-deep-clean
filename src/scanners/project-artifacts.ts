import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScanResult } from '../types.js';
import { findDirsNamed } from '../utils/find.js';
import { getSize, isDirectory, pathExists } from '../utils/fs.js';
import { HOME, findProtectedDescendant, isInside, isProtectedPath } from '../utils/paths.js';
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
  excludeRoots: string[] = [];
  protectedDirs: string[] | null = null;
  // Where the running tool lives; its own node_modules is found from here.
  ownDir: string = path.dirname(fileURLToPath(import.meta.url));

  async scan(): Promise<ScanResult[]> {
    const roots = await resolveSearchRoots(this.searchRoots);
    if (roots.length === 0) return [];

    const protectedDirs = this.protectedDirs ?? (await defaultProtectedDirs(this.ownDir));
    const skip = [...this.excludeRoots, ...protectedDirs];
    const results: ScanResult[] = [];

    for (const root of roots) {
      for (const target of await findDirsNamed(root, ARTIFACT_DIRS, MAX_DEPTH)) {
        if (await isInsideLinkedWorktree(target, root)) continue;
        if (await isExcluded(target, skip)) continue;
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
}

// Trees whose node_modules and similar dirs belong to installed software, not to a project.
const NON_PROJECT_TREES = ['/Applications', '/Library', '/opt', path.join(HOME, 'Library')];

/** Why `purge --path` must not walk `root`, or null when it is a plausible project folder. */
export function purgeRootProblem(root: string): string | null {
  const resolved = path.resolve(root);
  if (isProtectedPath(resolved)) return `${resolved} is a protected path`;
  const contained = findProtectedDescendant(resolved);
  if (contained) return `${resolved} contains the protected path ${contained}`;
  const tree = NON_PROJECT_TREES.find((t) => isInside(t, resolved));
  if (tree) return `${resolved} is inside ${tree}, which holds installed software, not projects`;
  return null;
}

/**
 * The real folder behind `root` and why purge must not walk it. A protected spelling is refused even when a
 * symlink moves it somewhere unprotected, and so is a plain spelling that really lands in a protected folder.
 */
export async function checkPurgeRoot(
  root: string,
): Promise<{ real: string; problem: string | null }> {
  const resolved = path.resolve(root);
  const real = await fs.realpath(resolved);
  return { real, problem: purgeRootProblem(resolved) ?? purgeRootProblem(real) };
}

export async function resolveSearchRoots(explicit: string[] | null): Promise<string[]> {
  if (explicit) return dedupeByRealpath(explicit);
  const found: string[] = [];
  for (const name of SEARCH_ROOTS) {
    const candidate = path.join(HOME, name);
    if (await isDirectory(candidate)) found.push(candidate);
  }
  return dedupeByRealpath(found);
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

async function realpathOr(p: string): Promise<string> {
  return fs.realpath(p).catch(() => path.resolve(p));
}

// True when target is one of the excluded dirs, sits inside one, or holds one (deleting it would take the excluded dir along).
export async function isExcluded(target: string, excludes: string[]): Promise<boolean> {
  if (excludes.length === 0) return false;
  const real = await realpathOr(target);
  for (const exclude of excludes) {
    const ex = await realpathOr(exclude);
    if (isInside(ex, real) || isInside(real, ex)) return true;
  }
  return false;
}

// The node_modules this tool imports from: deleting it would leave the CLI unable to start.
export async function findOwnNodeModules(startDir: string): Promise<string | null> {
  let dir = path.resolve(startDir);
  for (;;) {
    const pkg = await fs
      .readFile(path.join(dir, 'package.json'), 'utf8')
      .then((text) => JSON.parse(text) as { name?: string })
      .catch(() => null);
    if (pkg?.name === 'mac-deep-clean') return path.join(dir, 'node_modules');
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function defaultProtectedDirs(startDir: string): Promise<string[]> {
  const own = await findOwnNodeModules(startDir);
  return own ? [own] : [];
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
