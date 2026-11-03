import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();

const HOMES: readonly string[] = [...new Set([HOME, os.userInfo().homedir])];

const HOME_SUBTREES = [
  'Documents',
  'Desktop',
  'Downloads',
  'Pictures',
  'Music',
  'Movies',
  '.ssh',
  '.gnupg',
  'Library/Keychains',
  'Library/Preferences',
];

// Nothing under these is ever a deletion target.
const PROTECTED_SUBTREES: readonly string[] = [
  '/System',
  '/Library/System',
  '/usr',
  '/bin',
  '/sbin',
  '/private/var/db',
  '/private/var/protected',
  '/var/db',
  '/var/protected',
  ...HOMES.flatMap((home) => HOME_SUBTREES.map((sub) => path.join(home, sub))),
];

// Container directories: the directory itself is protected, its children are scanner targets.
const PROTECTED_EXACT: readonly string[] = [
  '/',
  '/Library',
  '/private',
  ...HOMES.flatMap((home) => [
    home,
    path.join(home, 'Library'),
    path.join(home, 'Library', 'Application Support'),
    path.join(home, 'Library', 'Containers'),
    path.join(home, 'Library', 'Group Containers'),
    path.join(home, 'Library', 'Caches'),
  ]),
];

export const PROTECTED_PATHS: readonly string[] = [...PROTECTED_EXACT, ...PROTECTED_SUBTREES];

const OTHER_USER_SUBTREE = new RegExp(
  `^/Users/[^/]+/(${HOME_SUBTREES.map((sub) => sub.replace('.', '\\.')).join('|')})(/|$)`,
  'i',
);

export function expandHome(p: string): string {
  if (p === '~') return HOME;
  if (p.startsWith('~/')) return path.join(HOME, p.slice(2));
  return p;
}

function fold(p: string): string {
  return path.resolve(expandHome(p)).toLowerCase();
}

export function isProtectedPath(target: string): boolean {
  const resolved = fold(target);
  if (PROTECTED_EXACT.some((p) => fold(p) === resolved)) return true;
  if (OTHER_USER_SUBTREE.test(resolved)) return true;
  return PROTECTED_SUBTREES.some((p) => {
    const root = fold(p);
    return resolved === root || resolved.startsWith(`${root}/`);
  });
}

function isAncestorOf(ancestor: string, descendant: string): boolean {
  const rel = path.relative(ancestor, descendant);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function assertSafeToDelete(target: string): void {
  const resolved = path.resolve(expandHome(target));
  if (isProtectedPath(resolved)) {
    throw new Error(`Refusing to delete protected path: ${resolved}`);
  }
  if (resolved === '/' || resolved.split(path.sep).filter(Boolean).length < 2) {
    throw new Error(`Refusing to delete near-root path: ${resolved}`);
  }
  for (const protectedPath of PROTECTED_PATHS) {
    const p = path.resolve(protectedPath);
    if (isAncestorOf(fold(resolved), fold(p))) {
      throw new Error(`Refusing to delete ancestor of protected path: ${resolved} (contains ${p})`);
    }
  }
}
