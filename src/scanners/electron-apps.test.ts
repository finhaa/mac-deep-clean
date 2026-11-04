import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { HOME } from '../utils/paths.js';

const CLAUDE = path.join(HOME, 'Library/Application Support/Claude');
const TREE: Record<string, string[]> = {
  [CLAUDE]: ['Cache', 'Service Worker', 'IndexedDB', 'User', 'vm_bundles', 'Local State', 'tiny'],
  [path.join(CLAUDE, 'User')]: ['workspaceStorage', 'settings.json', 'snippets'],
};
const FILES = new Set(['Local State', 'settings.json']);
const TINY = new Set([path.join(CLAUDE, 'tiny'), path.join(CLAUDE, 'User/snippets')]);

vi.mock('../utils/fs.js', () => ({
  pathExists: vi.fn(
    async (p: string) => p === CLAUDE || (TREE[path.dirname(p)] ?? []).includes(path.basename(p)),
  ),
  listDir: vi.fn(async (p: string) => TREE[p] ?? []),
  isDirectory: vi.fn(async (p: string) => !FILES.has(path.basename(p))),
  getSize: vi.fn(async (p: string) =>
    p === CLAUDE ? 5 * 1024 ** 3 : TINY.has(p) ? 1024 : 500 * 1024 * 1024,
  ),
}));

import { ElectronAppsScanner } from './electron-apps.js';

const claudePaths = async (deep: boolean) =>
  (await new ElectronAppsScanner().scan({ deep }))
    .filter((r) => r.label.startsWith('Claude'))
    .map((r) => r.path);

describe('ElectronAppsScanner --deep', () => {
  it('lists big state folders one by one', async () => {
    const paths = await claudePaths(true);
    expect(paths).toContain(path.join(CLAUDE, 'IndexedDB'));
    expect(paths).toContain(path.join(CLAUDE, 'vm_bundles'));
    expect(paths).toContain(path.join(CLAUDE, 'User/workspaceStorage'));
  });

  it('never offers the app folder, User, config files or small folders', async () => {
    const paths = await claudePaths(true);
    for (const forbidden of [
      CLAUDE,
      path.join(CLAUDE, 'User'),
      path.join(CLAUDE, 'User/settings.json'),
      path.join(CLAUDE, 'User/snippets'),
      path.join(CLAUDE, 'Local State'),
      path.join(CLAUDE, 'tiny'),
      path.join(CLAUDE, 'Service Worker'),
    ]) {
      expect(paths).not.toContain(forbidden);
    }
  });

  it('adds no state entries without --deep', async () => {
    const paths = await claudePaths(false);
    expect(paths).not.toContain(path.join(CLAUDE, 'IndexedDB'));
    expect(paths).toContain(path.join(CLAUDE, 'Cache'));
  });

  it('marks every state folder risky and irreversible, and the caches safe and not', async () => {
    const results = (await new ElectronAppsScanner().scan({ deep: true })).filter((r) =>
      r.label.startsWith('Claude'),
    );
    const state = results.filter((r) => r.label.endsWith('(state)'));
    const caches = results.filter((r) => !r.label.endsWith('(state)'));
    expect(state.length).toBeGreaterThan(0);
    expect(caches.length).toBeGreaterThan(0);
    expect(state.every((r) => r.risk === 'risky' && r.irreversible === true)).toBe(true);
    expect(caches.every((r) => r.risk === 'safe' && !r.irreversible)).toBe(true);
  });
});
