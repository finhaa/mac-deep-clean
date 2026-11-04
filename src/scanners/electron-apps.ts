import path from 'node:path';
import type { ScanOptions, ScanResult } from '../types.js';
import { getSize, isDirectory, listDir, pathExists } from '../utils/fs.js';
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

const CACHE_TOP_LEVEL = new Set(CACHE_SUBDIRS.map((sub) => sub.split('/')[0]));
const STATE_MIN_BYTES = 100 * 1024 * 1024;
// `User` holds settings.json, keybindings and snippets beside the big storage folders,
// so --deep descends into it and never offers it whole.
const DESCEND_INTO = new Set(['User']);

export class ElectronAppsScanner extends BaseScanner {
  readonly name = 'Electron Apps';
  readonly category = 'electron';
  readonly description = 'Regenerable caches from Electron-based apps (Claude, Cursor, etc.)';
  readonly risk = 'safe' as const;

  async scan(options: ScanOptions = {}): Promise<ScanResult[]> {
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

      if (options.deep) results.push(...(await this.stateEntries(appName, appRoot)));
    }
    return results.sort((a, b) => b.size - a.size);
  }

  private async stateEntries(appName: string, appRoot: string): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    for (const name of await listDir(appRoot)) {
      if (CACHE_TOP_LEVEL.has(name)) continue;
      const child = path.join(appRoot, name);
      const targets = DESCEND_INTO.has(name)
        ? (await listDir(child)).map((n) => path.join(child, n))
        : [child];
      for (const target of targets) {
        if (!(await isDirectory(target))) continue;
        const size = await getSize(target);
        if (size < STATE_MIN_BYTES) continue;
        const relative = path.relative(appRoot, target);
        results.push({
          path: target,
          size,
          label: `${appName} — ${relative} (state)`,
          category: this.category,
          risk: 'risky',
          irreversible: true,
          description: `${appName} ${relative}: conversations, workspaces, extension or session data. DELETING LOSES it. Settings files are never listed.`,
        });
      }
    }
    return results;
  }
}
