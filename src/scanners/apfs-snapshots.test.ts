import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/exec.js', () => ({
  commandExists: vi.fn(),
  run: vi.fn(),
}));

import type { ScanResult } from '../types.js';
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

const OS_UUID = '11111111-2222-3333-4444-555555555555';
const TM_UUID = '66666666-7777-8888-9999-000000000000';
const USER_UUID = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const OTHER_UUID = 'BBBBBBBB-CCCC-DDDD-EEEE-FFFFFFFFFFFF';
const entry = (uuid: string, name: string, xid: number) => `+-- ${uuid}
    Name:        ${name}
    XID:         ${xid}
    Purgeable:   No
`;
const MIXED_LISTING = `Snapshots for disk3s1 (3 found)
|
${entry(OS_UUID, 'com.apple.os.update-ABCDEF', 1)}|
${entry(TM_UUID, 'com.apple.TimeMachine.2026-11-02-120000.local', 2)}|
${entry(USER_UUID, 'com.example.backup.nightly', 3)}`;
const TWO_USER_LISTING = `${MIXED_LISTING}|
${entry(OTHER_UUID, 'com.example.backup.weekly', 4)}`;

// A listing or delete aimed at the root volume ("/") targets the sealed, read-only system
// volume. User data and local snapshots live on the Data volume.
const aimsAtRoot = (command: string) => /(listSnapshots|deleteSnapshot) \/( |$)/.test(command);

function item(uuid: string): ScanResult {
  return {
    path: `apfs:snapshot:${uuid}`,
    size: 0,
    label: 'snapshot',
    category: 'apfs-snapshots',
    risk: 'risky',
    virtual: true,
  };
}

const commands: string[] = [];

function listing(stdout: string, code = 0, stderr = '') {
  vi.mocked(run).mockImplementation(async (command: string) => {
    commands.push(command);
    return { stdout, stderr, code };
  });
}

const deletes = () => commands.filter((c) => c.includes('deleteSnapshot'));

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

describe('ApfsSnapshotsScanner.scan', () => {
  beforeEach(() => {
    commands.length = 0;
    vi.mocked(commandExists).mockResolvedValue(true);
    vi.mocked(run).mockReset();
  });

  it('lists snapshots on the Data volume, never on the sealed root volume', async () => {
    listing(MIXED_LISTING);

    const results = await new ApfsSnapshotsScanner().scan();

    expect(results).toHaveLength(1);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.some(aimsAtRoot)).toBe(false);
    expect(commands.every((c) => c.includes('/System/Volumes/Data'))).toBe(true);
  });

  it('fails closed: a snapshot whose name could not be read is not offered', async () => {
    listing(`Snapshot for disk3s1 (1 found)\n|\n+-- ${USER_UUID}\n    XID:         9\n`);

    expect(await new ApfsSnapshotsScanner().scan()).toEqual([]);
  });

  it('offers nothing when the only snapshot is the OS update boot snapshot', async () => {
    listing(REAL_ROOT_LISTING);

    expect(await new ApfsSnapshotsScanner().scan()).toEqual([]);
  });

  it('offers each deletable snapshot as its own item, shown by name', async () => {
    listing(TWO_USER_LISTING);

    const results = await new ApfsSnapshotsScanner().scan();

    expect(results.map((r) => r.path)).toEqual([
      `apfs:snapshot:${USER_UUID}`,
      `apfs:snapshot:${OTHER_UUID}`,
    ]);
    expect(results[0]?.label).toContain('com.example.backup.nightly');
    expect(results[1]?.label).toContain('com.example.backup.weekly');
  });

  it('marks the items virtual and risky, since they are privileged deletes of unknown snapshots', async () => {
    listing(MIXED_LISTING);

    const [result] = await new ApfsSnapshotsScanner().scan();

    expect(result?.virtual).toBe(true);
    expect(result?.risk).toBe('risky');
  });
});

describe('ApfsSnapshotsScanner.clean', () => {
  beforeEach(() => {
    commands.length = 0;
    vi.mocked(commandExists).mockResolvedValue(true);
    vi.mocked(run).mockReset();
  });

  it('deletes only the selected snapshot, on the Data volume', async () => {
    listing(TWO_USER_LISTING);

    const { errors } = await new ApfsSnapshotsScanner().clean([item(USER_UUID)], false);

    expect(errors).toEqual([]);
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0]).toContain('/System/Volumes/Data');
    expect(deletes()[0]).toContain(USER_UUID);
    expect(deletes()[0]).not.toContain(OTHER_UUID);
    expect(commands.some(aimsAtRoot)).toBe(false);
  });

  it('refuses a selected snapshot that is now a protected one', async () => {
    listing(MIXED_LISTING);

    const { freed, errors } = await new ApfsSnapshotsScanner().clean(
      [item(OS_UUID), item(TM_UUID)],
      false,
    );

    expect(deletes()).toEqual([]);
    expect(errors).toHaveLength(2);
    expect(freed).toBe(0);
  });

  it('refuses a snapshot that no longer exists', async () => {
    listing(MIXED_LISTING);

    const { errors } = await new ApfsSnapshotsScanner().clean([item(OTHER_UUID)], false);

    expect(deletes()).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it('refuses an item whose path is not a snapshot uuid, without running anything', async () => {
    listing(MIXED_LISTING);
    const forged = { ...item(USER_UUID), path: `apfs:snapshot:${USER_UUID}; touch /tmp/x` };

    const { errors } = await new ApfsSnapshotsScanner().clean([forged], false);

    expect(commands).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it('touches nothing on a dry run', async () => {
    listing(MIXED_LISTING);

    const { errors } = await new ApfsSnapshotsScanner().clean([item(USER_UUID)], true);

    expect(commands).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('reports an error and no bytes when the delete fails', async () => {
    vi.mocked(run).mockImplementation(async (command: string) => {
      commands.push(command);
      if (command.includes('deleteSnapshot')) {
        return { stdout: '', stderr: 'sudo: a password is required', code: 1 };
      }
      return { stdout: MIXED_LISTING, stderr: '', code: 0 };
    });

    const { freed, errors } = await new ApfsSnapshotsScanner().clean(
      [{ ...item(USER_UUID), size: 1000 }],
      false,
    );

    expect(errors).toHaveLength(1);
    expect(freed).toBe(0);
  });
});
