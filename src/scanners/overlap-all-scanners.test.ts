import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// HOME is read when paths.ts loads, so the scan never sees the real home folder or its search roots.
const HOME = vi.hoisted(() => {
  const home = `${process.env.TMPDIR ?? '/tmp'}/mdc-overlap-home-${process.pid}`;
  process.env.HOME = home;
  return home;
});

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

// These need the output of an external command, or a project found by `find`, which this world does not give them.
const EMPTY_IN_THIS_WORLD = [
  'apfs-snapshots',
  'docker',
  'git-tmp-packs',
  'homebrew',
  'launch-agents',
  'project-artifacts',
  'temp-files',
  'time-machine',
];

// Scanners that can emit an irreversible item in this world. A new one must be added here on purpose.
const IRREVERSIBLE_IN_THIS_WORLD = [
  'android',
  'electron',
  'ios-backups',
  'ios-simulators',
  'jetbrains',
  'music-creation',
  'screen-recording',
];

async function scanAll() {
  fs.mkdirSync(HOME, { recursive: true });
  const results: Array<{ scanner: string; path: string; irreversible: boolean }> = [];
  for (const scanner of getAllScanners()) {
    for (const r of await scanner.scan({ deep: true })) {
      results.push({
        scanner: scanner.category,
        path: r.path,
        irreversible: r.irreversible === true,
      });
    }
  }
  return results;
}

describe('every scanner together', () => {
  it('runs against a temp home folder, not the real one', () => {
    expect(HOME.startsWith(fs.realpathSync(os.tmpdir())) || HOME.startsWith(os.tmpdir())).toBe(
      true,
    );
    expect(os.homedir()).toBe(HOME);
  });

  it('has every scanner offer something, except the ones that need an external command', async () => {
    const offered = new Set((await scanAll()).map((e) => e.scanner));
    const silent = getAllScanners()
      .map((s) => s.category)
      .filter((category) => !offered.has(category))
      .sort();
    expect(silent).toEqual(EMPTY_IN_THIS_WORLD);
  });

  it('flags exactly the known scanners as irreversible', async () => {
    const flagged = [
      ...new Set((await scanAll()).filter((e) => e.irreversible).map((e) => e.scanner)),
    ].sort();
    expect(flagged).toEqual(IRREVERSIBLE_IN_THIS_WORLD);
  });

  it('never offers the same path twice, nor a path inside another scanner target', async () => {
    const entries = await scanAll();

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
