import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSafeToDelete, isProtectedPath } from './paths.js';

describe('isProtectedPath', () => {
  it('protects /System', () => {
    expect(isProtectedPath('/System')).toBe(true);
  });

  it('protects the home dir itself', () => {
    expect(isProtectedPath(os.homedir())).toBe(true);
  });

  it('protects ~/Documents', () => {
    expect(isProtectedPath(path.join(os.homedir(), 'Documents'))).toBe(true);
  });

  it('protects ~/Library (parent dir)', () => {
    expect(isProtectedPath(path.join(os.homedir(), 'Library'))).toBe(true);
  });

  it('does not protect arbitrary cache dirs', () => {
    expect(
      isProtectedPath(path.join(os.homedir(), 'Library/Application Support/Claude/Cache')),
    ).toBe(false);
  });
});

describe('assertSafeToDelete', () => {
  it('throws for protected paths', () => {
    expect(() => assertSafeToDelete(os.homedir())).toThrow();
    expect(() => assertSafeToDelete('/System')).toThrow();
  });

  it('throws for /', () => {
    expect(() => assertSafeToDelete('/')).toThrow();
  });

  it('allows deep cache paths', () => {
    expect(() =>
      assertSafeToDelete(path.join(os.homedir(), 'Library/Application Support/Claude/Cache')),
    ).not.toThrow();
  });

  it('throws when target is an ancestor of a protected path', () => {
    expect(() => assertSafeToDelete('/private/var')).toThrow(/ancestor of protected/);
    expect(() => assertSafeToDelete(path.join(os.homedir(), 'Library'))).toThrow();
  });
});

const home = os.homedir();
const PROTECTED_LITERALS = [
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
  home,
  path.join(home, 'Documents'),
  path.join(home, 'Desktop'),
  path.join(home, 'Downloads'),
  path.join(home, 'Pictures'),
  path.join(home, 'Music'),
  path.join(home, 'Movies'),
  path.join(home, '.ssh'),
  path.join(home, '.gnupg'),
  path.join(home, 'Library'),
  path.join(home, 'Library/Application Support'),
  path.join(home, 'Library/Containers'),
  path.join(home, 'Library/Group Containers'),
  path.join(home, 'Library/Caches'),
  path.join(home, 'Library/Preferences'),
  path.join(home, 'Library/Keychains'),
];

describe('every path the README promises to protect', () => {
  it.each(PROTECTED_LITERALS)('treats %s as protected and refuses to delete it', (target) => {
    expect(isProtectedPath(target)).toBe(true);
    expect(() => assertSafeToDelete(target)).toThrow(/Refusing to delete/);
  });

  it('names the protected path as the reason, for a path deep enough to pass the root check', () => {
    expect(() => assertSafeToDelete('/Library/System')).toThrow(/protected path/);
    expect(() => assertSafeToDelete(path.join(home, '.ssh'))).toThrow(/protected path/);
    expect(() => assertSafeToDelete(path.join(home, 'Library/Keychains'))).toThrow(
      /protected path/,
    );
  });
});

describe('assertSafeToDelete near-root guard', () => {
  it.each(['/tmp', '/opt', '/Applications'])('refuses the one-segment path %s', (target) => {
    expect(() => assertSafeToDelete(target)).toThrow(/near-root|protected/);
  });

  it('refuses /tmp as a near-root path even though it is not in the protected list', () => {
    expect(isProtectedPath('/tmp')).toBe(false);
    expect(() => assertSafeToDelete('/tmp')).toThrow(/near-root/);
  });

  it('allows a two-segment path that is neither protected nor an ancestor of one', () => {
    expect(() => assertSafeToDelete('/tmp/mdc-fine')).not.toThrow();
  });
});
