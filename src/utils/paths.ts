import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();

export const PROTECTED_PATHS: readonly string[] = [
  '/',
  '/System',
  '/Library',
  '/Library/System',
  '/usr',
  '/bin',
  '/sbin',
  '/private',
  '/private/var/db',
  '/private/var/protected',
  HOME,
  path.join(HOME, 'Documents'),
  path.join(HOME, 'Desktop'),
  path.join(HOME, 'Downloads'),
  path.join(HOME, 'Pictures'),
  path.join(HOME, 'Music'),
  path.join(HOME, 'Movies'),
  path.join(HOME, '.ssh'),
  path.join(HOME, '.gnupg'),
  path.join(HOME, 'Library'),
  path.join(HOME, 'Library', 'Application Support'),
  path.join(HOME, 'Library', 'Containers'),
  path.join(HOME, 'Library', 'Group Containers'),
  path.join(HOME, 'Library', 'Caches'),
  path.join(HOME, 'Library', 'Preferences'),
  path.join(HOME, 'Library', 'Keychains'),
];

export function expandHome(p: string): string {
  if (p === '~') return HOME;
  if (p.startsWith('~/')) return path.join(HOME, p.slice(2));
  return p;
}

export function isProtectedPath(target: string): boolean {
  const resolved = path.resolve(expandHome(target));
  for (const protectedPath of PROTECTED_PATHS) {
    const p = path.resolve(protectedPath);
    if (resolved === p) return true;
  }
  return false;
}

export function assertSafeToDelete(target: string): void {
  const resolved = path.resolve(expandHome(target));
  if (isProtectedPath(resolved)) {
    throw new Error(`Refusing to delete protected path: ${resolved}`);
  }
  if (resolved === '/' || resolved.split(path.sep).filter(Boolean).length < 2) {
    throw new Error(`Refusing to delete near-root path: ${resolved}`);
  }
}
