import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/exec.js', () => ({
  commandExists: vi.fn(),
  run: vi.fn(),
}));

import type { ScanResult } from '../types.js';
import { commandExists, run } from '../utils/exec.js';
import { TimeMachineScanner } from './time-machine.js';

const LISTING = `Snapshots for volume group containing disk /:
com.apple.TimeMachine.2026-11-02-120000.local
com.apple.TimeMachine.2026-11-03-080000.local
com.example.other.snapshot
com.apple.TimeMachine.not-a-date.local
`;

function item(date: string, size = 0): ScanResult {
  return {
    path: `tmutil:snapshot:${date}`,
    size,
    label: `snapshot ${date}`,
    category: 'time-machine',
    risk: 'moderate',
    virtual: true,
  };
}

const commands: string[] = [];

function answer(stdout: string, code = 0, stderr = '') {
  vi.mocked(run).mockImplementation(async (command: string) => {
    commands.push(command);
    return { stdout, stderr, code };
  });
}

beforeEach(() => {
  commands.length = 0;
  vi.mocked(commandExists).mockResolvedValue(true);
  vi.mocked(run).mockReset();
  answer(LISTING);
});

describe('TimeMachineScanner.scan', () => {
  it('offers one item per Time Machine snapshot, named by its date', async () => {
    const results = await new TimeMachineScanner().scan();

    expect(results.map((r) => r.path)).toEqual([
      'tmutil:snapshot:2026-11-02-120000',
      'tmutil:snapshot:2026-11-03-080000',
    ]);
    expect(results[0]?.label).toContain('2026-11-02-120000');
  });

  it('marks the items virtual, because a snapshot has no measurable size', async () => {
    const results = await new TimeMachineScanner().scan();

    expect(results.every((r) => r.size === 0 && r.virtual === true)).toBe(true);
  });

  it('ignores other snapshot names and a date that is not a date', async () => {
    const paths = (await new TimeMachineScanner().scan()).map((r) => r.path);

    expect(paths.some((p) => p.includes('other'))).toBe(false);
    expect(paths.some((p) => p.includes('not-a-date'))).toBe(false);
  });

  it('offers nothing when tmutil is missing', async () => {
    vi.mocked(commandExists).mockResolvedValue(false);

    expect(await new TimeMachineScanner().scan()).toEqual([]);
  });
});

describe('TimeMachineScanner.clean', () => {
  it('deletes exactly the selected snapshot and does not list or touch the others', async () => {
    answer('');

    const { errors } = await new TimeMachineScanner().clean([item('2026-11-02-120000')], false);

    expect(errors).toEqual([]);
    expect(commands).toEqual(['sudo tmutil deletelocalsnapshots 2026-11-02-120000']);
  });

  it('refuses an item whose path is not a snapshot date, without running anything', async () => {
    const forged = {
      ...item('2026-01-01-000000'),
      path: 'tmutil:snapshot:2026-01-01-000000; touch /tmp/x',
    };

    const { freed, errors } = await new TimeMachineScanner().clean([forged], false);

    expect(commands).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(freed).toBe(0);
  });

  it('touches nothing on a dry run', async () => {
    const { errors } = await new TimeMachineScanner().clean([item('2026-11-02-120000')], true);

    expect(commands).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('does not report bytes as freed when the delete fails', async () => {
    answer('', 1, 'sudo: a password is required');

    const { freed, errors } = await new TimeMachineScanner().clean(
      [item('2026-11-02-120000', 5 * 1024 ** 3), item('2026-11-03-080000', 5 * 1024 ** 3)],
      false,
    );

    expect(errors).toHaveLength(2);
    expect(freed).toBe(0);
  });
});
