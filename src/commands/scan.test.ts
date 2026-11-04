import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ora', () => {
  const spinner = { start: () => spinner, succeed: () => spinner, fail: () => spinner };
  return { default: () => spinner };
});
vi.mock('../scanners/index.js', () => ({ getAllScanners: vi.fn() }));

import { getAllScanners } from '../scanners/index.js';
import type { Risk, ScanResult } from '../types.js';
import { scanCommand } from './scan.js';

const item = (category: string, label: string, size = 2048): ScanResult => ({
  path: `/x/${label}`,
  size,
  label,
  category,
  risk: 'safe',
});

function scanner(category: string, risk: Risk, items: ScanResult[], error?: Error) {
  return {
    name: `Name ${category}`,
    category,
    description: category,
    risk,
    scan: vi.fn(async () => {
      if (error) throw error;
      return items;
    }),
    clean: vi.fn(),
  };
}

const logged = () =>
  vi
    .mocked(console.log)
    .mock.calls.map((c) => c.join(' '))
    .join('\n');

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('scanCommand', () => {
  it('lists each scanner with its items and the total, and deletes nothing', async () => {
    const a = scanner('a', 'safe', [item('a', 'alpha item')]);
    vi.mocked(getAllScanners).mockReturnValue([a] as never);
    await scanCommand({});
    expect(logged()).toContain('Name a');
    expect(logged()).toContain('alpha item');
    expect(logged()).toContain('Total cleanable');
    expect(a.clean).not.toHaveBeenCalled();
  });

  it('only runs the scanner of the requested category', async () => {
    const a = scanner('a', 'safe', [item('a', 'alpha')]);
    const b = scanner('b', 'safe', [item('b', 'beta')]);
    vi.mocked(getAllScanners).mockReturnValue([a, b] as never);
    await scanCommand({ category: 'b' });
    expect(a.scan).not.toHaveBeenCalled();
    expect(b.scan).toHaveBeenCalledTimes(1);
  });

  it('fails on an unknown category without scanning', async () => {
    const a = scanner('a', 'safe', []);
    vi.mocked(getAllScanners).mockReturnValue([a] as never);
    await scanCommand({ category: 'nope' });
    expect(process.exitCode).toBe(1);
    expect(a.scan).not.toHaveBeenCalled();
  });

  it('shows at most eight items per scanner and counts the rest', async () => {
    const many = Array.from({ length: 11 }, (_, i) => item('a', `item-${i}`));
    vi.mocked(getAllScanners).mockReturnValue([scanner('a', 'safe', many)] as never);
    await scanCommand({});
    expect(logged()).toContain('item-7');
    expect(logged()).not.toContain('item-8');
    expect(logged()).toContain('and 3 more');
  });

  it('keeps items it cannot clean out of the total and lists them apart', async () => {
    const vm: ScanResult = { ...item('a', 'VM disk', 5000), cleanable: false };
    vi.mocked(getAllScanners).mockReturnValue([
      scanner('a', 'safe', [item('a', 'real', 1024), vm]),
    ] as never);
    await scanCommand({});
    expect(logged()).toContain('Not cleanable by this tool');
    expect(logged()).toContain('Estimated: 1.0 KB');
  });

  it('lists a virtual item of size 0 such as a snapshot', async () => {
    const snap: ScanResult = { ...item('a', 'snapshot-2026-11-04', 0), virtual: true };
    vi.mocked(getAllScanners).mockReturnValue([scanner('a', 'safe', [snap])] as never);
    await scanCommand({});
    expect(logged()).toContain('snapshot-2026-11-04');
  });

  it('prints no control characters from an item description or a scanner error', async () => {
    const described: ScanResult = {
      ...item('a', 'alpha'),
      cleanable: false,
      description: 'desc\u001b[2Jx',
    };
    vi.mocked(getAllScanners).mockReturnValue([
      scanner('a', 'safe', [described]),
      scanner('b', 'safe', [], new Error('boom\u001b[2Jy')),
    ] as never);
    await scanCommand({});
    expect(logged()).toContain('desc');
    expect(logged()).toContain('boom');
    expect(logged()).not.toContain('\u001b[2J');
  });

  it('reports a scanner that failed and still shows the others', async () => {
    vi.mocked(getAllScanners).mockReturnValue([
      scanner('a', 'safe', [], new Error('exploded')),
      scanner('b', 'safe', [item('b', 'beta')]),
    ] as never);
    await scanCommand({});
    expect(logged()).toContain('exploded');
    expect(logged()).toContain('beta');
  });
});

describe('scanCommand terminal safety', () => {
  const EVIL = 'Evil\u001b[2K\rLabel';

  it('strips control characters from a scanner name in the table', async () => {
    const a = { ...scanner('a', 'safe', [item('a', 'ok')]), name: EVIL };
    vi.mocked(getAllScanners).mockReturnValue([a] as never);
    await scanCommand({});
    const table = vi
      .mocked(console.log)
      .mock.calls.map((c) => String(c[0]))
      .find((line) => line.includes('Category'));
    expect(table).toContain('Evil?[2K?Label');
    expect(table).not.toMatch(/\u001b\[2K|\r/);
  });

  it('strips control characters from an item label', async () => {
    vi.mocked(getAllScanners).mockReturnValue([scanner('a', 'safe', [item('a', EVIL)])] as never);
    await scanCommand({});
    expect(logged()).toContain('Evil?[2K?Label');
    expect(logged()).not.toMatch(/\u001b\[2K|\r/);
  });

  it('strips control characters from the label of an item it cannot clean', async () => {
    const info = { ...item('a', EVIL), cleanable: false as const };
    vi.mocked(getAllScanners).mockReturnValue([scanner('a', 'safe', [info])] as never);
    await scanCommand({});
    expect(logged()).toContain('Evil?[2K?Label');
    expect(logged()).not.toMatch(/\u001b\[2K|\r/);
  });
});
