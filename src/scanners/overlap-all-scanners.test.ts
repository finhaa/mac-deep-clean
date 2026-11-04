import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { HOME } from '../utils/paths.js';

// Every folder name a scanner could meet is present everywhere, so each scanner reports all it can.
const NAMES = vi.hoisted(() => [
  'Arc',
  'Google',
  'Chrome',
  'com.apple.Safari',
  'Firefox',
  'BraveSoftware',
  'Microsoft Edge',
  'JetBrains',
  'Homebrew',
  'pip',
  'pypoetry',
  'uv',
  'deno',
  'Yarn',
  'CocoaPods',
  'pre-commit',
  'Composer',
  'Bazel',
  'go-build',
  'ms-playwright',
  'ms-playwright-mcp',
  'Spotify',
  'com.apple.wallpaper',
  'com.apple.wallpaper.agent',
  'com.apple.mail',
  'SomeOtherApp',
]);

vi.mock('../utils/fs.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/fs.js')>()),
  pathExists: vi.fn(async () => true),
  isDirectory: vi.fn(async () => true),
  listDir: vi.fn(async () => NAMES),
  getSize: vi.fn(async () => 5 * 1024 ** 3),
  sizeExcluding: vi.fn(async () => 5 * 1024 ** 3),
  safeRemove: vi.fn(),
}));

vi.mock('../utils/exec.js', () => ({
  commandExists: vi.fn(async () => false),
  run: vi.fn(async () => ({ stdout: '', stderr: '', code: 1 })),
  asInvokingUser: (cmd: string) => cmd,
}));

import { getAllScanners } from './index.js';
import { OWNED_BY_OTHER_SCANNERS } from './logs.js';

describe('every scanner together', () => {
  it('never offers the same path twice, nor a path inside another scanner target', async () => {
    const entries: Array<{ scanner: string; path: string }> = [];
    for (const scanner of getAllScanners()) {
      for (const r of await scanner.scan({ deep: true })) {
        entries.push({ scanner: scanner.category, path: r.path });
      }
    }
    expect(new Set(entries.map((e) => e.scanner)).size).toBeGreaterThan(10);

    const describeEntry = (e: { scanner: string; path: string }) =>
      `${e.scanner}:${path.relative(HOME, e.path)}`;
    const duplicates = entries
      .filter((e, i) => entries.findIndex((o) => o.path === e.path) !== i)
      .map(describeEntry);
    // Logs clears its folder except the children other scanners own, so those nest by design.
    const ownedByLogsParent = (a: { scanner: string; path: string }, b: { path: string }) =>
      a.scanner === 'logs' &&
      OWNED_BY_OTHER_SCANNERS.includes(path.relative(a.path, b.path).split(path.sep)[0] ?? '');
    const overlaps = entries.flatMap((a) =>
      entries
        .filter((b) => b.path.startsWith(`${a.path}/`) && !ownedByLogsParent(a, b))
        .map((b) => `${describeEntry(a)} contains ${describeEntry(b)}`),
    );
    expect(duplicates).toEqual([]);
    expect(overlaps).toEqual([]);
  });
});
