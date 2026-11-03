import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/exec.js', () => ({
  commandExists: vi.fn(),
  run: vi.fn(),
}));

import { commandExists, run } from '../utils/exec.js';
import { ApfsSnapshotsScanner } from './apfs-snapshots.js';

const UUID = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const LISTING = `Snapshots for disk3s1 (1 found)\n|\n+-- Snapshot UUID: ${UUID}\n`;

// A listing or delete aimed at the root volume ("/") targets the sealed, read-only system
// volume. User data and local snapshots live on the Data volume.
const aimsAtRoot = (command: string) => /(listSnapshots|deleteSnapshot) \/( |$)/.test(command);

describe('ApfsSnapshotsScanner', () => {
  beforeEach(() => {
    vi.mocked(commandExists).mockResolvedValue(true);
    vi.mocked(run).mockReset();
  });

  it('lists snapshots on the Data volume, never on the sealed root volume', async () => {
    const commands: string[] = [];
    vi.mocked(run).mockImplementation(async (command: string) => {
      commands.push(command);
      return { stdout: LISTING, stderr: '', code: 0 };
    });

    const results = await new ApfsSnapshotsScanner().scan();

    expect(results).toHaveLength(1);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.some(aimsAtRoot)).toBe(false);
    expect(commands.every((c) => c.includes('/System/Volumes/Data'))).toBe(true);
  });

  it('deletes snapshots on the Data volume, never on the sealed root volume', async () => {
    const commands: string[] = [];
    vi.mocked(run).mockImplementation(async (command: string) => {
      commands.push(command);
      return { stdout: LISTING, stderr: '', code: 0 };
    });

    await new ApfsSnapshotsScanner().clean(
      [
        {
          path: 'apfs:snapshots',
          size: 0,
          label: '1 APFS snapshot(s)',
          category: 'apfs-snapshots',
          risk: 'moderate',
          description: 'test',
        },
      ],
      false,
    );

    const deletes = commands.filter((c) => c.includes('deleteSnapshot'));
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain('/System/Volumes/Data');
    expect(commands.some(aimsAtRoot)).toBe(false);
  });
});
