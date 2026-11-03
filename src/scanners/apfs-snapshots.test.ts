import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/exec.js', () => ({
  commandExists: vi.fn(),
  run: vi.fn(),
}));

import { commandExists, run } from '../utils/exec.js';
import { ApfsSnapshotsScanner, parseSnapshots } from './apfs-snapshots.js';

// Captured from `diskutil apfs listSnapshots /` on a real Mac (macOS, sealed system volume).
const REAL_ROOT_LISTING = `Snapshot for disk3s3s1 (1 found)
|
+-- 7267AA4B-B819-4144-A659-C452B6CB7D4F
    Name:        com.apple.os.update-182F06D70C9D02A9A9077E3BC880E61BFCEE97BDF8F6804B657B29E28EBBCDF0
    XID:         13035382
    Purgeable:   No
    NOTE:        This snapshot limits the minimum size of APFS Container disk3
`;

const USER_UUID = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const entry = (uuid: string, name: string, xid: number) => `+-- ${uuid}
    Name:        ${name}
    XID:         ${xid}
    Purgeable:   No
`;
const MIXED_LISTING = `Snapshots for disk3s1 (3 found)
|
${entry('11111111-2222-3333-4444-555555555555', 'com.apple.os.update-ABCDEF', 1)}|
${entry('66666666-7777-8888-9999-000000000000', 'com.apple.TimeMachine.2026-11-02-120000.local', 2)}|
${entry(USER_UUID, 'com.example.backup.nightly', 3)}`;

// A listing or delete aimed at the root volume ("/") targets the sealed, read-only system
// volume. User data and local snapshots live on the Data volume.
const aimsAtRoot = (command: string) => /(listSnapshots|deleteSnapshot) \/( |$)/.test(command);

const target = {
  path: 'apfs:snapshots',
  size: 0,
  label: 'snapshots',
  category: 'apfs-snapshots',
  risk: 'moderate' as const,
  description: 'test',
};

describe('parseSnapshots', () => {
  it('reads uuid and name from the real diskutil layout', () => {
    expect(parseSnapshots(REAL_ROOT_LISTING)).toEqual([
      {
        uuid: '7267AA4B-B819-4144-A659-C452B6CB7D4F',
        name: 'com.apple.os.update-182F06D70C9D02A9A9077E3BC880E61BFCEE97BDF8F6804B657B29E28EBBCDF0',
      },
    ]);
  });

  it('returns nothing for an empty listing', () => {
    expect(parseSnapshots('No snapshots for disk3s1\n')).toEqual([]);
  });
});

describe('ApfsSnapshotsScanner', () => {
  beforeEach(() => {
    vi.mocked(commandExists).mockResolvedValue(true);
    vi.mocked(run).mockReset();
  });

  it('lists snapshots on the Data volume, never on the sealed root volume', async () => {
    const commands: string[] = [];
    vi.mocked(run).mockImplementation(async (command: string) => {
      commands.push(command);
      return { stdout: MIXED_LISTING, stderr: '', code: 0 };
    });

    const results = await new ApfsSnapshotsScanner().scan();

    expect(results).toHaveLength(1);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.some(aimsAtRoot)).toBe(false);
    expect(commands.every((c) => c.includes('/System/Volumes/Data'))).toBe(true);
  });

  it('fails closed: a snapshot whose name could not be read is not offered', async () => {
    vi.mocked(run).mockResolvedValue({
      stdout: `Snapshot for disk3s1 (1 found)\n|\n+-- ${USER_UUID}\n    XID:         9\n`,
      stderr: '',
      code: 0,
    });
    expect(await new ApfsSnapshotsScanner().scan()).toEqual([]);
  });

  it('offers nothing when the only snapshot is the OS update boot snapshot', async () => {
    vi.mocked(run).mockResolvedValue({ stdout: REAL_ROOT_LISTING, stderr: '', code: 0 });
    expect(await new ApfsSnapshotsScanner().scan()).toEqual([]);
  });

  it('counts only snapshots it may delete, not OS update or Time Machine ones', async () => {
    vi.mocked(run).mockResolvedValue({ stdout: MIXED_LISTING, stderr: '', code: 0 });
    const [result] = await new ApfsSnapshotsScanner().scan();
    expect(result?.label).toContain('1 APFS snapshot(s)');
  });

  it('deletes only the snapshot it may delete, on the Data volume', async () => {
    const commands: string[] = [];
    vi.mocked(run).mockImplementation(async (command: string) => {
      commands.push(command);
      return { stdout: MIXED_LISTING, stderr: '', code: 0 };
    });

    await new ApfsSnapshotsScanner().clean([target], false);

    const deletes = commands.filter((c) => c.includes('deleteSnapshot'));
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain('/System/Volumes/Data');
    expect(deletes[0]).toContain(USER_UUID);
    expect(commands.some(aimsAtRoot)).toBe(false);
  });
});
