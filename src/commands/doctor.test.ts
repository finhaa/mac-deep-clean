import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ reports: [] as unknown[] }));

vi.mock('ora', () => {
  const spinner = { start: () => spinner, succeed: () => spinner, stop: () => spinner };
  return { default: () => spinner };
});
vi.mock('../runner.js', () => ({ runScanners: vi.fn(async () => state.reports) }));
vi.mock('../scanners/index.js', () => ({ getAllScanners: () => [] }));
vi.mock('../utils/exec.js', () => ({
  run: vi.fn(async () => ({
    stdout: 'Filesystem 1024-blocks Used Available\n/dev/x 1000000 500000 500000\n',
    stderr: '',
    code: 0,
  })),
}));
vi.mock('../utils/fs.js', () => ({
  pathExists: vi.fn(async () => false),
  getSize: vi.fn(async () => 0),
}));

import type { ScannerReport } from '../types.js';
import { run } from '../utils/exec.js';
import { getSize, pathExists } from '../utils/fs.js';
import { doctorCommand } from './doctor.js';

const GB = 1024 ** 3;

function report(category: string, name: string, size: number, cleanable?: false): ScannerReport {
  return {
    name,
    category,
    description: name,
    risk: 'moderate',
    totalSize: size,
    results: [
      {
        path: `/x/${category}`,
        size,
        label: name,
        category,
        risk: 'moderate',
        ...(cleanable === false ? { cleanable } : {}),
      },
    ],
  };
}

let output: string;

const df = (used: number, avail: number, blocks = used + avail) =>
  `Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted on\n/dev/disk3s1 ${blocks} ${used} ${avail} 47% 1 2 0% /System/Volumes/Data\n`;
const ok = (stdout: string) => ({ stdout, stderr: '', code: 0 });

beforeEach(() => {
  vi.mocked(run).mockClear();
  output = '';
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    output += `${args.join(' ')}\n`;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('doctorCommand', () => {
  it('neither recommends nor totals an item this tool cannot clean', async () => {
    state.reports = [
      report('docker', 'Docker VM disk', 20 * GB, false),
      report('logs', 'Logs', 2 * GB),
    ];
    await doctorCommand();
    expect(output).not.toContain('--category docker');
    expect(output).toContain('--category logs');
    expect(output).toMatch(/Total potential:\s*\S*\s*2(\.0)?\s*GB/);
  });

  it('still tells the user about the item it cannot clean', async () => {
    state.reports = [report('docker', 'Docker VM disk', 20 * GB, false)];
    await doctorCommand();
    expect(output).toContain('Docker VM disk');
    expect(output).toContain('Not cleanable by this tool');
    expect(output).toContain('Nothing significant to recommend');
  });

  it('strips terminal control characters from labels it prints', async () => {
    state.reports = [report('docker', 'Evil\u001b[2K\rVM', 20 * GB, false)];
    await doctorCommand();
    expect(output).toContain('Evil?[2K?VM');
    expect(output).not.toContain('\u001b');
  });

  it('strips terminal control characters from item descriptions it prints', async () => {
    const r = report('docker', 'Docker VM disk', 20 * GB, false);
    r.results[0] = { ...r.results[0], description: 'note\u001b[2K\rhere' } as never;
    state.reports = [r];
    await doctorCommand();
    expect(output).toContain('note?[2K?here');
    expect(output).not.toContain('\u001b');
  });

  it('samples the Data volume on macOS, since the sealed system volume at / holds almost no user data', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    state.reports = [];
    await doctorCommand();
    expect(vi.mocked(run).mock.calls.map((c) => c[0])).toContain('df -k /System/Volumes/Data');
  });

  it('samples / elsewhere', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    state.reports = [];
    await doctorCommand();
    expect(vi.mocked(run).mock.calls.map((c) => c[0])).toContain('df -k /');
  });

  it('reports free space against used plus free, since the container total on a shared APFS volume is not this volume', async () => {
    vi.mocked(run).mockResolvedValueOnce(ok(df(424_000_000, 492_000_000, 971_298_980)));
    state.reports = [];
    await doctorCommand();
    expect(output).toContain('(53.7%)');
    expect(output).not.toContain('56.4%');
  });

  it('shows the same total it measured the percentage against', async () => {
    vi.mocked(run).mockResolvedValueOnce(ok(df(424_000_000, 492_000_000, 971_298_980)));
    state.reports = [];
    await doctorCommand();
    expect(output).toContain('874 GB total');
  });

  it('warns about low space on the used-plus-free base', async () => {
    vi.mocked(run).mockResolvedValueOnce(ok(df(900_000, 95_000, 1_000_000)));
    state.reports = [];
    await doctorCommand();
    expect(output).toContain('Low disk space');
  });

  it('only says the disk is filling up between 10% and 20% free', async () => {
    vi.mocked(run).mockResolvedValueOnce(ok(df(850_000, 150_000)));
    state.reports = [];
    await doctorCommand();
    expect(output).toContain('Disk filling up');
    expect(output).not.toContain('Low disk space');
  });

  it('prints no warning with plenty of room', async () => {
    vi.mocked(run).mockResolvedValueOnce(ok(df(500_000, 500_000)));
    state.reports = [];
    await doctorCommand();
    expect(output).not.toContain('⚠');
  });

  it('prints no disk line when df fails or prints only a header', async () => {
    vi.mocked(run).mockResolvedValueOnce({ stdout: df(500_000, 500_000), stderr: 'boom', code: 1 });
    vi.mocked(run).mockResolvedValueOnce(ok('Filesystem 1024-blocks Used Available\n'));
    state.reports = [];
    await doctorCommand();
    await doctorCommand();
    expect(output).not.toContain('Disk:');
  });

  it.each([
    [795_000, 205_000, false, false],
    [805_000, 195_000, true, false],
    [895_000, 105_000, true, false],
    [905_000, 95_000, false, true],
  ])(
    'with %i used and %i free the warnings are filling up %s, low %s',
    async (used, avail, filling, low) => {
      vi.mocked(run).mockResolvedValueOnce(ok(df(used, avail)));
      state.reports = [];
      await doctorCommand();
      expect(output.includes('Disk filling up')).toBe(filling);
      expect(output.includes('Low disk space')).toBe(low);
    },
  );

  it('has no warning at exactly 20% free and only the filling-up one at exactly 10% free', async () => {
    vi.mocked(run).mockResolvedValueOnce(ok(df(800_000, 200_000)));
    state.reports = [];
    await doctorCommand();
    expect(output).toContain('(20.0%)');
    expect(output).not.toContain('Disk filling up');
    expect(output).not.toContain('Low disk space');

    output = '';
    vi.mocked(run).mockResolvedValueOnce(ok(df(900_000, 100_000)));
    await doctorCommand();
    expect(output).toContain('(10.0%)');
    expect(output).toContain('Disk filling up');
    expect(output).not.toContain('Low disk space');
  });

  it('recommends a category from 1 GiB up and not below it', async () => {
    state.reports = [
      report('logs', 'Logs', GB),
      report('user-cache', 'User Caches', GB - 1),
      report('spotify', 'Spotify', 1000 ** 3),
    ];
    await doctorCommand();
    expect(output).toContain('--category logs');
    expect(output).not.toContain('--category user-cache');
    expect(output).not.toContain('--category spotify');
  });

  describe('top consumers', () => {
    const MB = 1024 ** 2;
    const sizes: Record<string, number> = {
      'Library/Application Support': 100,
      'Library/Containers': 200,
      'Library/Group Containers': 300,
      'Library/Caches': 400,
      'Library/Developer': 500,
      'Library/Logs': 600,
      Documents: 700,
      Downloads: 800,
      Movies: 900,
      Pictures: 1000,
    };
    const lines = () => output.split('\n').filter((line) => /^\s+\d+\. ~\//.test(line));

    afterEach(() => {
      vi.mocked(pathExists).mockImplementation(async () => false);
      vi.mocked(getSize).mockImplementation(async () => 0);
    });

    it('lists the eight largest home folders, largest first, numbered from 1', async () => {
      vi.mocked(pathExists).mockImplementation(async () => true);
      vi.mocked(getSize).mockImplementation(async (target) => {
        const rel = Object.keys(sizes).find((k) => target.endsWith(`/${k}`));
        return (rel ? (sizes[rel] ?? 0) : 0) * MB;
      });
      state.reports = [];

      await doctorCommand();

      const shown = lines().map((line) => line.trim().split(/\s+/).slice(0, 2).join(' '));
      expect(shown).toEqual([
        '1. ~/Pictures',
        '2. ~/Movies',
        '3. ~/Downloads',
        '4. ~/Documents',
        '5. ~/Library/Logs',
        '6. ~/Library/Developer',
        '7. ~/Library/Caches',
        '8. ~/Library/Group',
      ]);
    });

    it('skips a folder that does not exist', async () => {
      vi.mocked(pathExists).mockImplementation(async (target) => target.endsWith('/Movies'));
      vi.mocked(getSize).mockImplementation(async () => 5 * MB);
      state.reports = [];

      await doctorCommand();

      expect(lines()).toHaveLength(1);
      expect(lines()[0]).toContain('~/Movies');
    });
  });

  it('shows 100% free instead of NaN on a volume that reports no blocks', async () => {
    vi.mocked(run).mockResolvedValueOnce(ok(df(0, 0)));
    state.reports = [];
    await doctorCommand();
    expect(output).toContain('(100.0%)');
    expect(output).not.toContain('NaN');
  });
});
