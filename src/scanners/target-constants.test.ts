import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { HOME } from '../utils/paths.js';

vi.mock('../utils/fs.js', () => ({
  pathExists: vi.fn(async () => true),
  getSize: vi.fn(async () => 5 * 1024 ** 3),
  listDir: vi.fn(async () => []),
  isDirectory: vi.fn(async () => true),
  canWriteDir: vi.fn(async () => true),
}));

import { BrowserCacheScanner } from './browser-cache.js';
import { DevCacheScanner } from './dev-cache.js';
import { ElectronAppsScanner } from './electron-apps.js';
import { MusicCreationScanner } from './music-creation.js';
import { WallpaperCacheScanner } from './wallpaper-cache.js';

// Every path here is handed to rm -rf. A widened constant (Default/Cache to Default,
// Data/Library/Caches to Data, Apple Loops to Audio) must fail this file first.
const scanned = async (scanner: {
  scan: () => Promise<Array<{ path: string }>>;
}): Promise<string[]> =>
  (await scanner.scan()).map((r) =>
    r.path.startsWith(HOME) ? path.relative(HOME, r.path) : r.path,
  );

describe('deletion targets are pinned', () => {
  it('browser-cache', async () => {
    expect(await scanned(new BrowserCacheScanner())).toEqual([
      'Library/Application Support/Arc/User Data/Default/Cache',
      'Library/Application Support/Arc/User Data/Default/Code Cache',
      'Library/Application Support/Arc/User Data/Default/GPUCache',
      'Library/Caches/Arc',
      'Library/Application Support/Google/Chrome/Default/Cache',
      'Library/Application Support/Google/Chrome/Default/Code Cache',
      'Library/Application Support/Google/Chrome/Default/GPUCache',
      'Library/Caches/Google/Chrome',
      'Library/Caches/com.apple.Safari',
      'Library/Caches/Firefox',
      'Library/Application Support/BraveSoftware/Brave-Browser/Default/Cache',
      'Library/Caches/BraveSoftware',
      'Library/Application Support/Microsoft Edge/Default/Cache',
      'Library/Caches/Microsoft Edge',
    ]);
  });

  it('wallpaper', async () => {
    expect((await scanned(new WallpaperCacheScanner())).sort()).toEqual([
      'Library/Application Support/com.apple.wallpaper/aerials',
      'Library/Containers/com.apple.wallpaper.agent/Data/Library/Caches',
      'Library/Containers/com.apple.wallpaper/Data/Library/Caches',
    ]);
  });

  it('dev-cache', async () => {
    expect(await scanned(new DevCacheScanner())).toEqual([
      'Library/pnpm/store',
      '.pnpm-store',
      '.npm/_cacache',
      'Library/Caches/Yarn',
      '.cache/yarn',
      '.cargo/registry/cache',
      '.cargo/registry/src',
      'go/pkg/mod/cache',
      'Library/Caches/go-build',
      '.gradle/caches',
      '.m2/repository',
      'Library/Caches/pip',
      'Library/Caches/pypoetry',
      'Library/Caches/uv',
      '.bun/install/cache',
      'Library/Caches/deno',
      'Library/Caches/CocoaPods',
      '.cocoapods/repos',
      'Library/Caches/pre-commit',
      'Library/Caches/Composer',
      'Library/Caches/Bazel',
      '.terraform.d/plugin-cache',
    ]);
  });

  it('music-creation', async () => {
    expect(await scanned(new MusicCreationScanner())).toEqual([
      'Library/Application Support/GarageBand',
      'Library/Application Support/Logic',
      '/Library/Audio/Apple Loops',
      '/Library/Application Support/GarageBand',
      '/Library/Application Support/Logic',
    ]);
  });

  it('electron cache folders, per app', async () => {
    const rels = await scanned(new ElectronAppsScanner());
    const subs = [
      'Cache',
      'CachedData',
      'CachedExtensionVSIXs',
      'Code Cache',
      'GPUCache',
      'Service Worker/CacheStorage',
      'blob_storage',
      'logs',
    ];
    const apps = [
      'Claude',
      'Cursor',
      'Code',
      'Slack',
      'discord',
      'Notion',
      'Figma',
      'Figma Agent',
      'Linear',
      'obsidian',
      'Postman',
      'Insomnia',
      'mongodb-compass',
    ];
    expect(rels.sort()).toEqual(
      apps.flatMap((a) => subs.map((s) => `Library/Application Support/${a}/${s}`)).sort(),
    );
  });
});
