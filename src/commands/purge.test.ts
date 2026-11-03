import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  results: [] as unknown[],
  scanners: [] as { searchRoots: string[] | null; excludeRoots: string[]; scan: () => unknown }[],
  rm: undefined as unknown,
}));

vi.mock('ora', () => {
  const spinner = { start: () => spinner, succeed: () => spinner, fail: () => spinner };
  return { default: () => spinner };
});
vi.mock('@inquirer/prompts', () => ({ checkbox: vi.fn(), confirm: vi.fn() }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const rm = vi.fn(async () => {});
  state.rm = rm;
  return { ...actual, rm };
});
vi.mock('../scanners/project-artifacts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scanners/project-artifacts.js')>();
  class FakeScanner {
    searchRoots: string[] | null = null;
    excludeRoots: string[] = [];
    constructor() {
      state.scanners.push(this);
    }
    async scan() {
      return state.results;
    }
  }
  return { ...actual, ProjectArtifactsScanner: FakeScanner };
});

import type { ScanResult } from '../types.js';
import { purgeCommand } from './purge.js';

const art = (p: string): ScanResult => ({
  path: p,
  size: 20 * 1024 * 1024,
  label: p,
  category: 'project-artifacts',
  risk: 'moderate',
});

const rm = () => state.rm as ReturnType<typeof vi.fn>;
const removed = () => rm().mock.calls.map((c) => c[0] as string);
const NODE_MODULES = '/tmp/mdc-wiring/app/node_modules';
const VENV = '/tmp/mdc-wiring/app/.venv';

beforeEach(() => {
  state.results = [art(NODE_MODULES), art(VENV)];
  state.scanners.length = 0;
  rm().mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('purgeCommand --yes', () => {
  it('deletes build artifacts but leaves virtualenvs alone', async () => {
    await purgeCommand({ yes: true });
    expect(removed()).toEqual([NODE_MODULES]);
  });

  it('never removes a protected path, even when the scanner offers it', async () => {
    state.results = [art(os.homedir()), art(path.join(os.homedir(), '.ssh')), art(NODE_MODULES)];

    await purgeCommand({ yes: true });

    expect(removed()).toEqual([NODE_MODULES]);
  });

  it('deletes nothing on a dry run', async () => {
    await purgeCommand({ yes: true, dryRun: true });
    expect(rm()).not.toHaveBeenCalled();
  });

  it('deletes nothing when the scan finds nothing', async () => {
    state.results = [];
    await purgeCommand({ yes: true });
    expect(rm()).not.toHaveBeenCalled();
  });
});

describe('purgeCommand options', () => {
  it('expands ~ in --exclude and makes every entry absolute', async () => {
    await purgeCommand({ yes: true, dryRun: true, exclude: ['~/keep', '/abs/dir'] });
    expect(state.scanners[0]?.excludeRoots).toEqual([path.join(os.homedir(), 'keep'), '/abs/dir']);
  });

  it('leaves the excluded list empty when --exclude is not passed', async () => {
    await purgeCommand({ yes: true, dryRun: true });
    expect(state.scanners[0]?.excludeRoots).toEqual([]);
  });

  it('uses --path as the search roots', async () => {
    await purgeCommand({ yes: true, dryRun: true, path: [os.tmpdir()] });
    expect(state.scanners[0]?.searchRoots).toEqual([os.tmpdir()]);
  });

  it('rejects a --path that is not a directory and scans nothing', async () => {
    await purgeCommand({ yes: true, path: ['/definitely/not/a/dir'] });
    expect(process.exitCode).toBe(1);
    expect(state.scanners[0]?.searchRoots).toBeNull();
    expect(rm()).not.toHaveBeenCalled();
  });
});
