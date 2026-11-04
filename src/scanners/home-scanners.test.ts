import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ home: '', sizes: new Map<string, number>() }));

vi.mock('../utils/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/paths.js')>();
  const os = await import('node:os');
  const fs = await import('node:fs');
  const nodePath = await import('node:path');
  h.home = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'mdc-home-'));
  return { ...actual, HOME: h.home };
});

vi.mock('../utils/fs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/fs.js')>();
  return { ...actual, getSize: async (p: string) => h.sizes.get(p) ?? 0 };
});

import type { ScanResult } from '../types.js';
import { AndroidScanner } from './android.js';
import type { BaseScanner } from './base-scanner.js';
import { BrowserCacheScanner } from './browser-cache.js';
import { ContainersScanner } from './containers.js';
import { DevCacheScanner } from './dev-cache.js';
import { IosBackupsScanner } from './ios-backups.js';
import { JetBrainsScanner } from './jetbrains.js';
import { MailDownloadsScanner } from './mail-downloads.js';
import { SavedAppStateScanner } from './saved-app-state.js';
import { ScreenRecordingScanner } from './screen-recording.js';
import { TempFilesScanner } from './temp-files.js';
import { TrashScanner } from './trash.js';
import { UserCacheScanner } from './user-cache.js';
import { WallpaperCacheScanner } from './wallpaper-cache.js';

const MB = 1024 * 1024;

async function put(rel: string, size: number): Promise<string> {
  const dir = path.join(h.home, rel);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'file'), 'x');
  h.sizes.set(dir, size);
  return dir;
}

const rel = (results: ScanResult[]) => results.map((r) => path.relative(h.home, r.path)).sort();

beforeEach(async () => {
  h.sizes.clear();
  for (const name of await fsp.readdir(h.home)) {
    await fsp.rm(path.join(h.home, name), { recursive: true, force: true });
  }
});

afterAll(async () => {
  await fsp.rm(h.home, { recursive: true, force: true });
});

describe('scanners that report one fixed folder', () => {
  it.each([
    [new MailDownloadsScanner(), 'Library/Containers/com.apple.mail/Data/Library/Mail Downloads'],
    [new SavedAppStateScanner(), 'Library/Saved Application State'],
  ] as [BaseScanner, string][])(
    '%s reports its folder only when it holds something',
    async (scanner, folder) => {
      expect(await scanner.scan()).toEqual([]);
      await put(folder, 0);
      expect(await scanner.scan()).toEqual([]);
      await put(folder, 5 * MB);
      const results = await scanner.scan();
      expect(rel(results)).toEqual([folder]);
      expect(results[0]).toMatchObject({
        size: 5 * MB,
        category: scanner.category,
        risk: scanner.risk,
      });
    },
  );
});

describe('AndroidScanner', () => {
  it('reports the SDK, AVDs of 100 MB or more and Android Studio caches of 10 MB or more', async () => {
    await put('Library/Android/sdk', 1);
    await put('.android/avd/big.avd', 100 * MB);
    await put('.android/avd/small.avd', 100 * MB - 1);
    await put('Library/Caches/Google/AndroidStudio2024.1', 10 * MB);
    await put('Library/Caches/Google/AndroidStudio2023.3', 10 * MB - 1);
    await put('Library/Caches/Google/Chrome', 500 * MB);
    const results = await new AndroidScanner().scan();
    expect(rel(results)).toEqual([
      '.android/avd/big.avd',
      'Library/Android/sdk',
      'Library/Caches/Google/AndroidStudio2024.1',
    ]);
    const studio = results.find((r) => r.path.includes('AndroidStudio'));
    expect(studio?.risk).toBe('safe');
    expect(results.find((r) => r.path.endsWith('sdk'))?.risk).toBe('moderate');
  });

  it('reports nothing on a machine without Android tooling', async () => {
    expect(await new AndroidScanner().scan()).toEqual([]);
  });
});

describe('BrowserCacheScanner', () => {
  it('reports a browser cache of 1 MB or more and skips smaller ones', async () => {
    await put('Library/Application Support/Google/Chrome/Default/Cache', MB);
    await put('Library/Application Support/Google/Chrome/Default/GPUCache', MB - 1);
    await put('Library/Caches/com.apple.Safari', 40 * MB);
    const results = await new BrowserCacheScanner().scan();
    expect(rel(results)).toEqual([
      'Library/Application Support/Google/Chrome/Default/Cache',
      'Library/Caches/com.apple.Safari',
    ]);
    expect(results.map((r) => r.label).sort()).toEqual(['Chrome cache', 'Safari cache']);
  });
});

describe('ContainersScanner', () => {
  it('reports container and group container caches of 10 MB or more', async () => {
    await put('Library/Containers/com.example.app/Data/Library/Caches', 20 * MB);
    await put('Library/Containers/com.example.small/Data/Library/Caches', 10 * MB - 1);
    await put('Library/Containers/.hidden/Data/Library/Caches', 20 * MB);
    await put('Library/Group Containers/group.example/Library/Caches', 30 * MB);
    const results = await new ContainersScanner().scan();
    expect(rel(results)).toEqual([
      'Library/Containers/com.example.app/Data/Library/Caches',
      'Library/Group Containers/group.example/Library/Caches',
    ]);
    expect(results[0]?.size).toBeGreaterThanOrEqual(results[1]?.size ?? 0);
  });

  it('leaves out the containers the wallpaper scanner owns', async () => {
    const [owned] = WallpaperCacheScanner.skippedContainerBundleIds;
    await put(`Library/Containers/${owned}/Data/Library/Caches`, 50 * MB);
    expect(await new ContainersScanner().scan()).toEqual([]);
  });
});

describe('DevCacheScanner', () => {
  it('reports package caches of 10 MB or more and marks the Maven repository moderate', async () => {
    await put('.npm/_cacache', 10 * MB);
    await put('.m2/repository', 20 * MB);
    await put('.cargo/registry/cache', 10 * MB - 1);
    const results = await new DevCacheScanner().scan();
    expect(rel(results)).toEqual(['.m2/repository', '.npm/_cacache']);
    expect(results.find((r) => r.path.endsWith('_cacache'))?.risk).toBe('safe');
    expect(results.find((r) => r.path.endsWith('repository'))?.risk).toBe('moderate');
  });
});

describe('IosBackupsScanner', () => {
  it('reports each backup of 10 MB or more, largest first, and warns that deletion is permanent', async () => {
    const root = 'Library/Application Support/MobileSync/Backup';
    await put(`${root}/aaaa1111bbbb2222cccc`, 11 * MB);
    await put(`${root}/dddd3333eeee4444ffff`, 90 * MB);
    await put(`${root}/small`, MB);
    await put(`${root}/.hidden`, 90 * MB);
    const results = await new IosBackupsScanner().scan();
    expect(rel(results)).toEqual([`${root}/aaaa1111bbbb2222cccc`, `${root}/dddd3333eeee4444ffff`]);
    expect(results[0]?.size).toBe(90 * MB);
    expect(results[0]?.description).toContain('permanent');
  });

  it('reports nothing without a backup folder', async () => {
    expect(await new IosBackupsScanner().scan()).toEqual([]);
  });
});

describe('risk labels of folders that can hold work not stored elsewhere', () => {
  it('keeps Mail Downloads, JetBrains and Trash out of the safe tier', async () => {
    await put('Library/Containers/com.apple.mail/Data/Library/Mail Downloads', 5 * MB);
    await put('Library/Caches/JetBrains/IntelliJIdea2024.1', 40 * MB);
    await put('.Trash', 5 * MB);
    for (const scanner of [
      new MailDownloadsScanner(),
      new JetBrainsScanner(),
      new TrashScanner(),
    ]) {
      const results = await scanner.scan();
      expect(scanner.risk, scanner.name).toBe('moderate');
      expect(results.length, scanner.name).toBeGreaterThan(0);
      expect(
        results.every((r) => r.risk === 'moderate'),
        scanner.name,
      ).toBe(true);
    }
  });
});

describe('JetBrainsScanner', () => {
  it('reports per-IDE caches and logs of 10 MB or more, largest first', async () => {
    await put('Library/Caches/JetBrains/IntelliJIdea2024.1', 40 * MB);
    await put('Library/Logs/JetBrains/IntelliJIdea2024.1', 12 * MB);
    await put('Library/Caches/JetBrains/Tiny', MB);
    await put('Library/Caches/JetBrains/.hidden', 99 * MB);
    const results = await new JetBrainsScanner().scan();
    expect(rel(results)).toEqual([
      'Library/Caches/JetBrains/IntelliJIdea2024.1',
      'Library/Logs/JetBrains/IntelliJIdea2024.1',
    ]);
    expect(results.map((r) => r.size)).toEqual([40 * MB, 12 * MB]);
    expect(results[0]?.label).toBe('IntelliJIdea2024.1 (caches)');
  });
});

describe('ScreenRecordingScanner', () => {
  it('reports recording app data of 10 MB or more as moderate', async () => {
    await put('Library/Application Support/so.cap.desktop', 30 * MB);
    await put('Library/Application Support/com.obsproject.obs-studio', MB);
    await put('Library/Application Support/Screen Studio', 10 * MB);
    const results = await new ScreenRecordingScanner().scan();
    expect(results.map((r) => r.label).sort()).toEqual(['Cap data', 'Screen Studio data']);
    expect(results.every((r) => r.risk === 'moderate')).toBe(true);
  });
});

describe('UserCacheScanner', () => {
  it('reports generic caches of 50 MB or more and skips the ones other scanners own', async () => {
    await put('Library/Caches/com.example.big', 60 * MB);
    await put('Library/Caches/com.example.mid', 50 * MB - 1);
    await put('Library/Caches/Homebrew', 900 * MB);
    await put('Library/Caches/ms-playwright', 900 * MB);
    await put('Library/Caches/.hidden', 900 * MB);
    const results = await new UserCacheScanner().scan();
    expect(rel(results)).toEqual(['Library/Caches/com.example.big']);
  });
});

describe('BaseScanner.clean through a real scanner', () => {
  it('removes the reported folder and counts its size as freed', async () => {
    const folder = 'Library/Saved Application State';
    const dir = await put(folder, 7 * MB);
    const scanner = new SavedAppStateScanner();
    const { freed, errors } = await scanner.clean(await scanner.scan());
    expect(errors).toEqual([]);
    expect(freed).toBe(7 * MB);
    await expect(fsp.stat(dir)).rejects.toThrow();
  });

  it('removes nothing on a dry run but still reports the size', async () => {
    const dir = await put('Library/Saved Application State', 7 * MB);
    const scanner = new SavedAppStateScanner();
    const { freed, errors } = await scanner.clean(await scanner.scan(), true);
    expect(errors).toEqual([]);
    expect(freed).toBe(7 * MB);
    await expect(fsp.stat(dir)).resolves.toBeDefined();
  });

  it('refuses a protected path, reports it as an error and frees nothing', async () => {
    const { freed, errors } = await new SavedAppStateScanner().clean([
      { path: '/', size: 9, label: 'x', category: 'saved-app-state', risk: 'safe' },
    ]);
    expect(freed).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Refusing to delete');
  });
});

describe('TrashScanner', () => {
  it('adds up what is in the trash and reports it as one item', async () => {
    await put('.Trash/a', 3 * MB);
    await put('.Trash/b', 4 * MB);
    const [item, ...rest] = await new TrashScanner().scan();
    expect(rest).toEqual([]);
    expect(item).toMatchObject({
      path: path.join(h.home, '.Trash'),
      size: 7 * MB,
      risk: 'moderate',
    });
  });

  it('reports nothing for an empty or missing trash', async () => {
    expect(await new TrashScanner().scan()).toEqual([]);
    await put('.Trash/a', 0);
    expect(await new TrashScanner().scan()).toEqual([]);
  });
});

describe('TempFilesScanner.scan', () => {
  it('offers the per-user temp dir only from 10 MB', async () => {
    const tmp = await put('T', 10 * MB - 1);
    vi.spyOn(os, 'tmpdir').mockReturnValue(tmp);
    expect(await new TempFilesScanner().scan()).toEqual([]);
    h.sizes.set(tmp, 10 * MB);
    const [item] = await new TempFilesScanner().scan();
    expect(item).toMatchObject({ path: tmp, size: 10 * MB, risk: 'moderate' });
    vi.restoreAllMocks();
  });

  it('reports nothing when the temp dir does not exist', async () => {
    vi.spyOn(os, 'tmpdir').mockReturnValue(path.join(h.home, 'nope'));
    expect(await new TempFilesScanner().scan()).toEqual([]);
    vi.restoreAllMocks();
  });
});
