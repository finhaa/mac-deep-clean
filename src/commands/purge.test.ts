import fsp from 'node:fs/promises';
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
vi.mock('../utils/fs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/fs.js')>();
  const rm = vi.fn(async (_target: string) => {});
  state.rm = rm;
  // The real guard runs first, so a protected path never reaches the recorded delete.
  const safeRemove = async (target: string) => rm(await actual.resolveDeletionTarget(target));
  return { ...actual, safeRemove };
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

import { checkbox, confirm } from '@inquirer/prompts';
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

  it('warns about a path that resolves to a protected one on a dry run, as a real run would', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-purge-dry-'));
    const link = path.join(dir, 'home');
    await fsp.symlink(os.homedir(), link);
    state.results = [art(path.join(link, '.ssh'))];

    await purgeCommand({ yes: true, dryRun: true });

    const printed = vi
      .mocked(console.log)
      .mock.calls.map((c) => c.join(' '))
      .join('\n');
    expect(printed).toContain('1 warning(s)');
    expect(rm()).not.toHaveBeenCalled();
    await fsp.rm(dir, { recursive: true, force: true });
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
    expect(state.scanners[0]?.searchRoots).toEqual([await fsp.realpath(os.tmpdir())]);
  });

  it('walks the real folder behind a --path with a symlinked parent', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-purge-root-'));
    try {
      await fsp.mkdir(path.join(dir, 'real/child'), { recursive: true });
      await fsp.symlink(path.join(dir, 'real'), path.join(dir, 'link'));
      await purgeCommand({ yes: true, dryRun: true, path: [path.join(dir, 'link/child')] });
      expect(state.scanners[0]?.searchRoots).toEqual([
        await fsp.realpath(path.join(dir, 'real/child')),
      ]);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects a --path that is not a directory and scans nothing', async () => {
    await purgeCommand({ yes: true, path: ['/definitely/not/a/dir'] });
    expect(process.exitCode).toBe(1);
    expect(state.scanners[0]?.searchRoots).toBeNull();
    expect(rm()).not.toHaveBeenCalled();
  });
});

describe('purgeCommand --path', () => {
  it.each([os.homedir(), '/Applications', '/opt'])(
    'refuses %s as a root before scanning anything',
    async (root) => {
      await purgeCommand({ path: [root], yes: true });
      expect(process.exitCode).toBe(1);
      expect(state.scanners[0]?.searchRoots).toBeNull();
      expect(removed()).toEqual([]);
    },
  );

  it.each(['bin', 'sbin'])(
    'refuses /usr/%s reached through a symlink, checked on where it really points',
    async (sub) => {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-purge-root-'));
      try {
        await fsp.symlink('/usr', path.join(dir, 'link'));
        await purgeCommand({ path: [path.join(dir, 'link', sub)], yes: true });
        expect(process.exitCode).toBe(1);
        expect(state.scanners[0]?.searchRoots).toBeNull();
        const err = vi
          .mocked(console.error)
          .mock.calls.map((c) => c.join(' '))
          .join('\n');
        expect(err).toContain('protected path');
      } finally {
        await fsp.rm(dir, { recursive: true, force: true });
      }
    },
  );
});

describe('purgeCommand interactive', () => {
  beforeEach(() => {
    vi.mocked(checkbox).mockReset();
    vi.mocked(confirm).mockReset();
    vi.mocked(checkbox).mockResolvedValue([0, 1] as never);
    vi.mocked(confirm).mockResolvedValue(true as never);
  });

  it('pre-ticks build artifacts but not virtualenvs', async () => {
    await purgeCommand({});
    const { choices } = vi.mocked(checkbox).mock.calls[0]?.[0] as unknown as {
      choices: { checked: boolean }[];
    };
    expect(choices.map((c) => c.checked)).toEqual([true, false]);
  });

  it('deletes the picked dirs once the user confirms', async () => {
    await purgeCommand({});
    expect(removed()).toEqual([NODE_MODULES, VENV]);
  });

  it('defaults the confirmation to no', async () => {
    await purgeCommand({});
    expect(vi.mocked(confirm)).toHaveBeenCalledWith(expect.objectContaining({ default: false }));
  });

  it('deletes nothing when the user declines', async () => {
    vi.mocked(confirm).mockResolvedValue(false as never);
    await purgeCommand({});
    expect(rm()).not.toHaveBeenCalled();
  });

  it('does not ask for confirmation on a dry run and deletes nothing', async () => {
    await purgeCommand({ dryRun: true });
    expect(vi.mocked(confirm)).not.toHaveBeenCalled();
    expect(rm()).not.toHaveBeenCalled();
  });

  it('stops when nothing is picked', async () => {
    vi.mocked(checkbox).mockResolvedValue([] as never);
    await purgeCommand({});
    expect(vi.mocked(confirm)).not.toHaveBeenCalled();
    expect(rm()).not.toHaveBeenCalled();
  });

  it('reports a dir it could not delete and goes on with the rest', async () => {
    rm().mockRejectedValueOnce(new Error('EACCES'));
    await purgeCommand({});
    expect(removed()).toEqual([NODE_MODULES, VENV]);
    const out = vi
      .mocked(console.log)
      .mock.calls.map((c) => c.join(' '))
      .join('\n');
    expect(out).toContain('EACCES');
  });

  it('refuses a dir that reaches a protected path through a symlinked parent', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-purge-link-'));
    try {
      await fsp.symlink('/usr', path.join(dir, 'link'));
      state.results = [art(path.join(dir, 'link', 'bin'))];
      await purgeCommand({});
      expect(rm()).not.toHaveBeenCalled();
      const out = vi
        .mocked(console.log)
        .mock.calls.map((c) => c.join(' '))
        .join('\n');
      expect(out).toContain('protected');
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('strips terminal control characters from a deletion error', async () => {
    rm().mockRejectedValueOnce(new Error('bad\u001b[2K\rname'));
    await purgeCommand({});
    const out = vi
      .mocked(console.log)
      .mock.calls.map((c) => c.join(' '))
      .join('\n');
    expect(out).toContain('bad?[2K?name');
    expect(out).not.toContain('\u001b');
  });
});

describe('purgeCommand terminal safety', () => {
  const EVIL = 'Evil\u001b[2K\rLabel';
  const out = () =>
    vi
      .mocked(console.log)
      .mock.calls.map((c) => c.join(' '))
      .join('\n');

  it('strips control characters from a label in the --yes listing', async () => {
    state.results = [{ ...art(NODE_MODULES), label: EVIL }];
    await purgeCommand({ yes: true, dryRun: true });
    expect(out()).toContain('Evil?[2K?Label');
    expect(out()).not.toContain('\u001b[2K');
    expect(out()).not.toContain('\r');
  });

  it('strips control characters from a label in the picker', async () => {
    state.results = [{ ...art(NODE_MODULES), label: EVIL }];
    vi.mocked(checkbox).mockReset();
    vi.mocked(checkbox).mockResolvedValue([] as never);
    await purgeCommand({});
    const { choices } = vi.mocked(checkbox).mock.calls[0]?.[0] as unknown as {
      choices: { name: string }[];
    };
    expect(choices[0]?.name).toContain('Evil?[2K?Label');
    expect(choices[0]?.name).not.toContain('\u001b[2K');
    expect(choices[0]?.name).not.toContain('\r');
  });
});
