import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();

function realpathOr(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

// A home spelled through a symlink must protect the folders it really points at, so every spelling of every
// home counts, and so does each one's real path. Any list built from a home goes through this one.
export const HOMES: readonly string[] = [
  ...new Set([HOME, os.userInfo().homedir].flatMap((home) => [home, realpathOr(home)])),
];

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
  'Library/Mobile Documents',
  'Library/Mail',
  'Library/Messages',
];

// Nothing under these is ever a deletion target.
const PROTECTED_SUBTREES: readonly string[] = [
  '/System',
  '/Library/System',
  '/usr',
  '/bin',
  '/sbin',
  '/etc',
  '/private/etc',
  '/Applications',
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

// Another user's home folder itself: its project folders stay deletable, the folder does not.
const OTHER_USER_HOME = /^\/users\/[^/]+$/;

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
  return path.resolve(expandHome(p)).normalize('NFC').toLowerCase();
}

/** True when `child` is `parent` or lies below it, ignoring case like the default macOS volume. */
export function isInside(parent: string, child: string): boolean {
  const root = fold(parent);
  const target = fold(child);
  return target === root || target.startsWith(root.endsWith('/') ? root : `${root}/`);
}

export function isProtectedPath(target: string): boolean {
  const resolved = fold(target);
  if (PROTECTED_EXACT.some((p) => fold(p) === resolved)) return true;
  if (OTHER_USER_HOME.test(resolved) || OTHER_USER_SUBTREE.test(resolved)) return true;
  return PROTECTED_SUBTREES.some((p) => {
    const root = fold(p);
    return resolved === root || resolved.startsWith(`${root}/`);
  });
}

function isAncestorOf(ancestor: string, descendant: string): boolean {
  const rel = path.relative(ancestor, descendant);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function findProtectedDescendant(target: string): string | undefined {
  const resolved = path.resolve(expandHome(target));
  return PROTECTED_PATHS.map((p) => path.resolve(p)).find((p) =>
    isAncestorOf(fold(resolved), fold(p)),
  );
}

export function assertSafeToDelete(target: string): void {
  const resolved = path.resolve(expandHome(target));
  if (isProtectedPath(resolved)) {
    throw new Error(`Refusing to delete protected path: ${resolved}`);
  }
  if (resolved === '/' || resolved.split(path.sep).filter(Boolean).length < 2) {
    throw new Error(`Refusing to delete near-root path: ${resolved}`);
  }
  const contained = findProtectedDescendant(resolved);
  if (contained) {
    throw new Error(
      `Refusing to delete ancestor of protected path: ${resolved} (contains ${contained})`,
    );
  }
}
