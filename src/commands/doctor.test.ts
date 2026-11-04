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

beforeEach(() => {
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
});
