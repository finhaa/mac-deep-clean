import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSafeToDelete, isInside, isProtectedPath } from './paths.js';

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

describe('protected subtrees (README: never touched, nor any directory that contains one)', () => {
  const subtreeFiles = [
    '/System/Library/CoreServices',
    '/Library/System/x',
    '/usr/local/lib/node_modules',
    '/var/db/dslocal',
    '/private/var/db/dslocal',
    '/private/var/protected/x',
    path.join(home, 'Documents/x'),
    path.join(home, 'Documents/a/b/node_modules'),
    path.join(home, 'Desktop/x'),
    path.join(home, 'Downloads/x'),
    path.join(home, 'Pictures/Photos Library.photoslibrary'),
    path.join(home, 'Music/x'),
    path.join(home, 'Movies/x'),
    path.join(home, '.ssh/id_rsa'),
    path.join(home, '.gnupg/private-keys-v1.d'),
    path.join(home, 'Library/Keychains/login.keychain-db'),
    path.join(home, 'Library/Preferences/com.apple.finder.plist'),
    '/Users/other/Documents/x',
    '/Users/other/.ssh/id_rsa',
  ];

  it.each(subtreeFiles)('refuses to delete %s', (target) => {
    expect(isProtectedPath(target)).toBe(true);
    expect(() => assertSafeToDelete(target)).toThrow(/Refusing to delete protected path/);
  });

  it('matches case-insensitively, like the default APFS volume', () => {
    expect(() => assertSafeToDelete(path.join(home, 'DOCUMENTS/x'))).toThrow(/protected path/);
    expect(() => assertSafeToDelete('/SYSTEM/Library/x')).toThrow(/protected path/);
  });

  it('does not treat a sibling that only shares a name prefix as protected', () => {
    expect(isProtectedPath(path.join(home, 'Documents-old/x'))).toBe(false);
    expect(isProtectedPath('/usr-local/x')).toBe(false);
  });
});

describe('container directories stay exact-match so their children remain deletable', () => {
  const deletable = [
    path.join(home, 'Library/Caches/com.example.app'),
    path.join(home, 'Library/Application Support/Claude/Cache'),
    path.join(home, 'Library/Containers/com.apple.mail/Data/Library/Mail Downloads'),
    path.join(home, 'Library/Group Containers/group.x/cache'),
    path.join(home, 'Library/Logs/JetBrains'),
    '/Library/Caches/com.apple.x',
    '/Library/Logs/DiagnosticReports',
    '/Library/Audio/Apple Loops',
  ];

  it.each(deletable)('allows %s', (target) => {
    expect(isProtectedPath(target)).toBe(false);
    expect(() => assertSafeToDelete(target)).not.toThrow();
  });
});

describe('isInside', () => {
  it('matches the folder itself and anything below it, whatever the case', () => {
    expect(isInside('/Applications', '/Applications')).toBe(true);
    expect(isInside('/Applications', '/applications/Foo.app')).toBe(true);
    expect(isInside('/opt', '/OPT/homebrew')).toBe(true);
  });

  it('does not match a sibling that only shares a name prefix', () => {
    expect(isInside('/opt', '/optical')).toBe(false);
    expect(isInside('/opt', '/tmp/opt')).toBe(false);
  });

  it('resolves relative segments before comparing', () => {
    expect(isInside('/opt', '/opt/../tmp')).toBe(false);
  });
});
