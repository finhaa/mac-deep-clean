import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/exec.js', () => ({
  commandExists: vi.fn(),
  run: vi.fn(),
}));

import { run } from '../utils/exec.js';
import { TimeMachineScanner } from './time-machine.js';

describe('TimeMachineScanner.clean', () => {
  it('does not report bytes as freed when every snapshot delete fails', async () => {
    const runMock = vi.mocked(run);
    runMock.mockImplementation(async (command: string) => {
      if (command.startsWith('tmutil listlocalsnapshotdates')) {
        return { stdout: '2024-01-01-000000\n2024-01-02-000000\n', stderr: '', code: 0 };
      }
      if (command.startsWith('sudo tmutil deletelocalsnapshots')) {
        return { stdout: '', stderr: 'sudo: a password is required', code: 1 };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const scanner = new TimeMachineScanner();
    const { freed, errors } = await scanner.clean(
      [
        {
          path: 'tmutil:snapshots',
          size: 5 * 1024 ** 3,
          label: '2 local Time Machine snapshot(s)',
          category: 'time-machine',
          risk: 'moderate',
          description: 'sudo tmutil deletelocalsnapshots / (requires sudo)',
        },
      ],
      false,
    );

    expect(errors).toHaveLength(2);
    expect(freed).toBe(0);
  });
});
