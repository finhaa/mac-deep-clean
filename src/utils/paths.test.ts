import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { assertSafeToDelete, isInside, isProtectedPath, isStrictlyInside } from './paths.js';

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
    '/var/protected',
    '/var/protected/x',
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
    path.join(home, 'Library/Mobile Documents/com~apple~CloudDocs/x'),
    path.join(home, 'Library/Mail/V10/x'),
    path.join(home, 'Library/Messages/chat.db'),
    '/Users/other/Library/Mobile Documents/x',
    '/Users/other/Library/Mail/V10',
    '/Users/other/Library/Messages/chat.db',
    '/etc/hosts',
    '/private/etc/hosts',
    '/Applications/Foo.app',
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

describe('isInside with the filesystem root', () => {
  it('holds everything when the parent is /', () => {
    expect(isInside('/', '/')).toBe(true);
    expect(isInside('/', '/opt/homebrew')).toBe(true);
  });
});

describe('isStrictlyInside', () => {
  it('holds for a path below the parent, whatever the case', () => {
    expect(isStrictlyInside('/opt', '/opt/homebrew')).toBe(true);
    expect(isStrictlyInside('/OPT', '/opt/homebrew/bin')).toBe(true);
    expect(isStrictlyInside('/', '/opt')).toBe(true);
  });

  it('is false for the parent itself, a sibling with a shared prefix and an unrelated path', () => {
    expect(isStrictlyInside('/opt', '/opt')).toBe(false);
    expect(isStrictlyInside('/opt', '/OPT/')).toBe(false);
    expect(isStrictlyInside('/opt', '/optical')).toBe(false);
    expect(isStrictlyInside('/opt', '/tmp/opt')).toBe(false);
    expect(isStrictlyInside('/opt/homebrew', '/opt')).toBe(false);
    expect(isStrictlyInside('/', '/')).toBe(false);
  });
});

describe('isInside', () => {
  it('matches the folder itself and anything below it, whatever the case', () => {
    expect(isInside('/Applications', '/Applications')).toBe(true);
    expect(isInside('/Applications', '/applications/Foo.app')).toBe(true);
    expect(isInside('/opt', '/OPT/homebrew')).toBe(true);
  });

  it('folds case the way the filesystem does, so a long s names the same folder as s', () => {
    expect(isInside('/Applications', '/Application\u017f/Foo.app')).toBe(true);
    expect(() => assertSafeToDelete(path.join(os.homedir(), 'Document\u017f'))).toThrow();
    expect(isProtectedPath('/Sy\u017ftem/Library/x')).toBe(true);
    expect(isProtectedPath(path.join(os.homedir(), 'Document\u017f/x'))).toBe(true);
    expect(isProtectedPath(path.join(os.homedir(), 'Document\u017f-old/x'))).toBe(false);
  });

  it('folds a capital sharp s to ss, as the default volume does', () => {
    expect(isInside('/tmp/.ssh', '/tmp/.\u1e9eh/x')).toBe(true);
    expect(isProtectedPath(path.join(os.homedir(), '.\u1e9eh'))).toBe(true);
    expect(isProtectedPath(path.join(os.homedir(), 'Library/Me\u1e9eages/x'))).toBe(true);
    expect(() => assertSafeToDelete(path.join(os.homedir(), '.\u1e9eh'))).toThrow(/protected/);
  });

  it('does not match a sibling that only shares a name prefix', () => {
    expect(isInside('/opt', '/optical')).toBe(false);
    expect(isInside('/opt', '/tmp/opt')).toBe(false);
  });

  it('resolves relative segments before comparing', () => {
    expect(isInside('/opt', '/opt/../tmp')).toBe(false);
  });
});

describe('the home folder of another user', () => {
  it.each(['/Users/other', '/Users/other/', '/users/OTHER'])('protects %s itself', (target) => {
    expect(isProtectedPath(target)).toBe(true);
    expect(() => assertSafeToDelete(target)).toThrow(/Refusing to delete protected path/);
  });

  it('leaves a project folder inside it to the scanners', () => {
    expect(isProtectedPath('/Users/other/code/app/node_modules')).toBe(false);
  });

  it('protects its private folders under a long s or capital sharp s spelling', () => {
    expect(isProtectedPath('/Uſers/other/Documentſ/x')).toBe(true);
    expect(isProtectedPath('/Users/other/.ẞh/id_rsa')).toBe(true);
  });
});

describe('a HOME that is spelled through a symlink', () => {
  it('still protects the real folders behind it', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-home-link-'));
    try {
      const realHome = path.join(dir, 'real');
      await fsp.mkdir(realHome);
      const linkHome = path.join(dir, 'link');
      await fsp.symlink(realHome, linkHome);
      vi.resetModules();
      vi.stubEnv('HOME', linkHome);
      const fresh = await import('./paths.js');
      expect(fresh.isProtectedPath(path.join(linkHome, 'Documents/x'))).toBe(true);
      expect(fresh.isProtectedPath(path.join(await fsp.realpath(realHome), 'Documents/x'))).toBe(
        true,
      );
      expect(fresh.isProtectedPath(await fsp.realpath(realHome))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('protects only its own spelling when HOME does not exist', async () => {
    try {
      vi.resetModules();
      vi.stubEnv('HOME', '/mdc-missing/home');
      const fresh = await import('./paths.js');
      expect(fresh.isProtectedPath('/mdc-missing/home/Documents/x')).toBe(true);
      expect(fresh.isProtectedPath('/nonexistent-home/Documents/x')).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe('HOMES under sudo', () => {
  async function homesWith(sudoUser: string | undefined) {
    vi.resetModules();
    vi.stubEnv('SUDO_USER', sudoUser);
    return (await import('./paths.js')).HOMES;
  }

  it('lists the home of the user who ran sudo, which a sudo -H run does not put in HOME', async () => {
    try {
      expect(await homesWith('mdcalice')).toContain('/Users/mdcalice');
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it.each(['root', '', '.', '..', '../etc', 'a/b', 'a b'])(
    'adds nothing for SUDO_USER=%j',
    async (name) => {
      try {
        const without = await homesWith(undefined);
        expect(await homesWith(name)).toEqual(without);
      } finally {
        vi.unstubAllEnvs();
        vi.resetModules();
      }
    },
  );

  it('loads without the shell-spawning exec module, so a test that mocks it strictly still runs under sudo', async () => {
    try {
      vi.doMock('./exec.js', () => ({}));
      expect(await homesWith('mdcalice')).toContain('/Users/mdcalice');
    } finally {
      vi.doUnmock('./exec.js');
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe('a path spelled with decomposed Unicode', () => {
  it('compares equal to its precomposed spelling', () => {
    expect(isInside('/tmp/café', '/tmp/café/x')).toBe(true);
    expect(isInside('/tmp/café', '/tmp/café/x')).toBe(true);
  });

  it('composes before folding case, so a mark on a letter with a lower case form of its own still matches', () => {
    expect(isInside('/tmp/ᾄ', '/tmp/ᾄ/x')).toBe(true);
  });

  it('composes after folding case, so a mark on a long s matches the accented s', () => {
    expect(isInside('/tmp/ś', '/tmp/ſ́/x')).toBe(true);
  });

  it('keeps a HOME with an accent protected under either spelling', async () => {
    try {
      vi.resetModules();
      vi.stubEnv('HOME', '/mdc-missing/josé');
      const fresh = await import('./paths.js');
      expect(fresh.isProtectedPath('/mdc-missing/josé/Documents/x')).toBe(true);
      expect(fresh.isProtectedPath('/mdc-missing/josé')).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe('a passwd home spelled through a symlink', () => {
  it('protects the real folders behind it too', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-passwd-home-'));
    try {
      await fsp.mkdir(path.join(dir, 'real'));
      await fsp.symlink(path.join(dir, 'real'), path.join(dir, 'link'));
      vi.resetModules();
      vi.stubEnv('HOME', '/mdc-missing/home');
      vi.spyOn(os, 'userInfo').mockReturnValue({
        homedir: path.join(dir, 'link'),
      } as os.UserInfo<string>);
      const fresh = await import('./paths.js');
      const real = await fsp.realpath(path.join(dir, 'real'));
      expect(fresh.isProtectedPath(path.join(real, 'Documents/x'))).toBe(true);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      vi.resetModules();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('a home that does not exist', () => {
  it('is listed once, as spelled', async () => {
    try {
      vi.resetModules();
      vi.stubEnv('HOME', '/mdc-missing/home');
      vi.spyOn(os, 'userInfo').mockReturnValue({
        homedir: '/mdc-missing/home',
      } as os.UserInfo<string>);
      const fresh = await import('./paths.js');
      expect(fresh.HOMES).toEqual(['/mdc-missing/home']);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
