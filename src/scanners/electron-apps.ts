import path from 'node:path';
import type { ScanResult } from '../types.js';
import { getSize, pathExists } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

const ELECTRON_APPS: Record<string, string> = {
  Claude: 'Claude',
  Cursor: 'Cursor',
  'VS Code': 'Code',
  Slack: 'Slack',
  Discord: 'discord',
  Notion: 'Notion',
  Figma: 'Figma',
  'Figma Agent': 'Figma Agent',
  Linear: 'Linear',
  Obsidian: 'obsidian',
  Postman: 'Postman',
  Insomnia: 'Insomnia',
  'MongoDB Compass': 'mongodb-compass',
};

const CACHE_SUBDIRS = [
  'Cache',
  'CachedData',
  'CachedExtensionVSIXs',
  'Code Cache',
  'GPUCache',
  'Service Worker/CacheStorage',
  'blob_storage',
  'logs',
];

export class ElectronAppsScanner extends BaseScanner {
  readonly name = 'Electron Apps';
  readonly category = 'electron';
  readonly description = 'Regenerable caches from Electron-based apps (Claude, Cursor, etc.)';
  readonly risk = 'safe' as const;

  async scan(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    const appSupport = path.join(HOME, 'Library/Application Support');

    for (const [appName, dirName] of Object.entries(ELECTRON_APPS)) {
      const appRoot = path.join(appSupport, dirName);
      if (!(await pathExists(appRoot))) continue;

      for (const sub of CACHE_SUBDIRS) {
        const target = path.join(appRoot, sub);
        if (!(await pathExists(target))) continue;
        const size = await getSize(target);
        if (size < 1024 * 1024) continue;
        results.push({
          path: target,
          size,
          label: `${appName} — ${sub}`,
          category: this.category,
          risk: this.risk,
          description: `${appName} cache: ${sub}`,
        });
      }
    }
    return results;
  }
}
