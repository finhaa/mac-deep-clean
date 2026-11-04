import fsp from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ home: '', sizes: new Map<string, number>() }));

vi.mock('../utils/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/paths.js')>();
  const os = await import('node:os');
  const fs = await import('node:fs');
  const nodePath = await import('node:path');
  h.home = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'mdc-exechome-'));
  return { ...actual, HOME: h.home };
});
vi.mock('../utils/fs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/fs.js')>();
  return { ...actual, getSize: async (p: string) => h.sizes.get(p) ?? 0 };
});
vi.mock('../utils/exec.js', () => ({
  asInvokingUser: (command: string) => command,
  commandExists: vi.fn(),
  run: vi.fn(),
}));

import type { ScanResult } from '../types.js';
import { commandExists, run } from '../utils/exec.js';
import { DockerScanner } from './docker.js';
import { HomebrewScanner } from './homebrew.js';
import { IosSimulatorsScanner } from './ios-simulators.js';

const runMock = vi.mocked(run);
const existsMock = vi.mocked(commandExists);
const ok = (stdout = '') => ({ stdout, stderr: '', code: 0 });
const fail = (stderr = 'boom') => ({ stdout: '', stderr, code: 1 });
const commands = () => runMock.mock.calls.map(([command]) => command);
const MB = 1024 * 1024;

const item = (p: string, size = 5 * MB): ScanResult => ({
  path: p,
  size,
  label: p,
  category: 'x',
  risk: 'safe',
});

async function put(rel: string, size: number): Promise<string> {
  const dir = path.join(h.home, rel);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'file'), 'x');
  h.sizes.set(dir, size);
  return dir;
}

beforeEach(async () => {
  runMock.mockReset();
  existsMock.mockReset();
  h.sizes.clear();
  for (const name of await fsp.readdir(h.home)) {
    await fsp.rm(path.join(h.home, name), { recursive: true, force: true });
  }
});

afterAll(async () => {
  await fsp.rm(h.home, { recursive: true, force: true });
});

describe('HomebrewScanner', () => {
  it('reports nothing when brew is missing, fails or prints no cache path', async () => {
    runMock.mockResolvedValueOnce(fail());
    expect(await new HomebrewScanner().scan()).toEqual([]);
    runMock.mockResolvedValueOnce(ok()).mockResolvedValueOnce(fail());
    expect(await new HomebrewScanner().scan()).toEqual([]);
    runMock.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok('  \n'));
    expect(await new HomebrewScanner().scan()).toEqual([]);
  });

  it('reports the cache folder as one cleanup item with its size', async () => {
    const cache = await put('brew-cache', 12 * MB);
    runMock.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok(`${cache}\n`));
    const [result, ...rest] = await new HomebrewScanner().scan();
    expect(rest).toEqual([]);
    expect(result).toMatchObject({ path: 'brew:cleanup', size: 12 * MB, category: 'homebrew' });
    expect(result?.description).toContain(cache);
    expect(result?.description).toContain('--prune=all');
    expect(result?.description).toContain('at most');
  });

  it('reports nothing for a cache folder that is missing or empty', async () => {
    runMock.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok(path.join(h.home, 'nope')));
    expect(await new HomebrewScanner().scan()).toEqual([]);
    const cache = await put('empty-cache', 0);
    runMock.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok(cache));
    expect(await new HomebrewScanner().scan()).toEqual([]);
  });

  it('runs brew cleanup for real, counts the size as freed and reports a failure', async () => {
    runMock.mockResolvedValueOnce(ok());
    const done = await new HomebrewScanner().clean([item('brew:cleanup')]);
    expect(commands()).toEqual(['brew cleanup -s --prune=all']);
    expect(done).toEqual({ freed: 5 * MB, errors: [] });

    runMock.mockResolvedValueOnce(fail('no space'));
    const failed = await new HomebrewScanner().clean([item('brew:cleanup')]);
    expect(failed.freed).toBe(0);
    expect(failed.errors[0]).toContain('no space');
  });

  it('runs nothing on a dry run', async () => {
    const result = await new HomebrewScanner().clean([item('brew:cleanup')], true);
    expect(runMock).not.toHaveBeenCalled();
    expect(result).toEqual({ freed: 5 * MB, errors: [] });
  });
});

describe('IosSimulatorsScanner', () => {
  const devices = 'Library/Developer/CoreSimulator/Devices';

  it('offers the simulator cleanup only when xcrun exists', async () => {
    await put(devices, 9 * MB);
    existsMock.mockResolvedValue(false);
    expect(await new IosSimulatorsScanner().scan()).toEqual([]);
    existsMock.mockResolvedValue(true);
    const [result] = await new IosSimulatorsScanner().scan();
    expect(result).toMatchObject({ path: 'xcrun:simctl:unavailable', size: 9 * MB });
    expect(result?.description).toContain('at most');
  });

  it('reports DerivedData as safe and Archives as moderate', async () => {
    existsMock.mockResolvedValue(false);
    await put('Library/Developer/Xcode/DerivedData', 3 * MB);
    await put('Library/Developer/Xcode/Archives', 4 * MB);
    const results = await new IosSimulatorsScanner().scan();
    expect(results.map((r) => [path.basename(r.path), r.risk])).toEqual([
      ['DerivedData', 'safe'],
      ['Archives', 'moderate'],
    ]);
  });

  it('deletes unavailable simulators through simctl and DerivedData through the guard', async () => {
    const derived = await put('Library/Developer/Xcode/DerivedData', 3 * MB);
    runMock.mockResolvedValue(ok());
    const { freed, errors } = await new IosSimulatorsScanner().clean([
      item('xcrun:simctl:unavailable', 2 * MB),
      item(derived, 3 * MB),
    ]);
    expect(commands()).toEqual(['xcrun simctl delete unavailable']);
    expect(errors).toEqual([]);
    expect(freed).toBe(5 * MB);
    await expect(fsp.stat(derived)).rejects.toThrow();
  });

  it('reports a simctl failure and does not count its size', async () => {
    runMock.mockResolvedValue(fail('simctl broke'));
    const { freed, errors } = await new IosSimulatorsScanner().clean([
      item('xcrun:simctl:unavailable', 2 * MB),
    ]);
    expect(freed).toBe(0);
    expect(errors[0]).toContain('simctl broke');
  });

  it('touches nothing on a dry run', async () => {
    const derived = await put('Library/Developer/Xcode/DerivedData', 3 * MB);
    const { freed } = await new IosSimulatorsScanner().clean(
      [item('xcrun:simctl:unavailable', 2 * MB), item(derived, 3 * MB)],
      true,
    );
    expect(runMock).not.toHaveBeenCalled();
    expect(freed).toBe(5 * MB);
    await expect(fsp.stat(derived)).resolves.toBeDefined();
  });
});

describe('DockerScanner', () => {
  const DF = 'Images\t3GB (60%)\nBuild Cache\t1GB (50%)\n';

  it('reports nothing without docker', async () => {
    existsMock.mockResolvedValue(false);
    expect(await new DockerScanner().scan()).toEqual([]);
  });

  it('reports the reclaimable total as one prune item and the VM disk as info only', async () => {
    existsMock.mockResolvedValue(true);
    runMock.mockResolvedValueOnce(ok(DF));
    await put('Library/Containers/com.docker.docker/Data/vms', 20 * MB);
    const results = await new DockerScanner().scan();
    expect(results.map((r) => [r.path, r.cleanable])).toEqual([
      ['docker:system', undefined],
      [path.join(h.home, 'Library/Containers/com.docker.docker/Data/vms'), false],
    ]);
    expect(results[0]?.size).toBe(4 * 1024 ** 3);
  });

  it('reports no prune item when docker is not answering', async () => {
    existsMock.mockResolvedValue(true);
    runMock.mockResolvedValueOnce(fail('daemon not running'));
    expect(await new DockerScanner().scan()).toEqual([]);
  });

  it('runs nothing on a dry run and refuses to clean the VM disk', async () => {
    const dry = await new DockerScanner().clean([item('docker:system', 7)], true);
    expect(runMock).not.toHaveBeenCalled();
    expect(dry).toEqual({ freed: 7, errors: [] });
    const vm = await new DockerScanner().clean([item('/some/vms', 9)]);
    expect(vm.freed).toBe(0);
    expect(vm.errors[0]).toContain('skipped');
  });

  it('reports a failed prune and does not count its size', async () => {
    runMock.mockResolvedValueOnce(fail('prune failed'));
    const { freed, errors } = await new DockerScanner().clean([item('docker:system', 7)]);
    expect(freed).toBe(0);
    expect(errors[0]).toContain('prune failed');
  });
});
