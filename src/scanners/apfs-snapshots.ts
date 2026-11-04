import type { CleanResult, ScanResult } from '../types.js';
import { commandExists, run } from '../utils/exec.js';
import { stripControl } from '../utils/format.js';
import { BaseScanner } from './base-scanner.js';

// The root volume is the sealed, read-only system snapshot; user data lives on the Data volume.
const VOLUME = '/System/Volumes/Data';

export interface Snapshot {
  uuid: string;
  name: string;
}

const UUID_LINE = /^[\s|+-]*([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})\s*$/i;
const NAME_LINE = /^\s*Name:\s*(.+?)\s*$/;
const ITEM_PATH = /^apfs:snapshot:([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})$/i;

// Never offered: the OS update snapshot backs the sealed system volume, and Time Machine local
// snapshots belong to the time-machine scanner.
const PROTECTED_NAME_PREFIXES = ['com.apple.os.update-', 'com.apple.TimeMachine.'];

export function parseSnapshots(output: string): Snapshot[] {
  const snapshots: Snapshot[] = [];
  let current: Snapshot | undefined;
  for (const line of output.split('\n')) {
    const uuid = line.match(UUID_LINE)?.[1];
    if (uuid) {
      current = { uuid, name: '' };
      snapshots.push(current);
      continue;
    }
    const name = line.match(NAME_LINE)?.[1];
    if (name && current && !current.name) current.name = name;
  }
  return snapshots;
}

function deletable(output: string): Snapshot[] {
  return parseSnapshots(output).filter(
    (s) => s.name !== '' && !PROTECTED_NAME_PREFIXES.some((prefix) => s.name.startsWith(prefix)),
  );
}

export class ApfsSnapshotsScanner extends BaseScanner {
  readonly name = 'APFS Snapshots';
  readonly category = 'apfs-snapshots';
  readonly description = 'APFS volume snapshots (requires sudo)';
  readonly risk = 'moderate' as const;

  async scan(): Promise<ScanResult[]> {
    if (!(await commandExists('diskutil'))) return [];
    const { stdout, code } = await run(`diskutil apfs listSnapshots ${VOLUME}`, {
      timeout: 10_000,
    });
    if (code !== 0) return [];

    return deletable(stdout).map((s) => ({
      path: `apfs:snapshot:${s.uuid}`,
      size: 0,
      virtual: true,
      label: `APFS snapshot "${stripControl(s.name)}" on ${VOLUME}`,
      category: this.category,
      risk: 'risky' as const,
      irreversible: true,
      description: `sudo diskutil apfs deleteSnapshot ${VOLUME} -uuid ${s.uuid} (requires sudo)`,
    }));
  }

  override async clean(results: ScanResult[], dryRun = false): Promise<CleanResult> {
    let freed = 0;
    const errors: string[] = [];
    for (const r of results) {
      const uuid = r.path.match(ITEM_PATH)?.[1];
      if (!uuid) {
        errors.push(`${r.path}: not an APFS snapshot`);
        continue;
      }
      if (dryRun) {
        freed += r.size;
        continue;
      }
      const { stdout, code, stderr } = await run(`diskutil apfs listSnapshots ${VOLUME}`, {
        timeout: 10_000,
      });
      if (code !== 0) {
        errors.push(`list snapshots: ${stderr}`);
        continue;
      }
      const snapshot = deletable(stdout).find((s) => s.uuid.toLowerCase() === uuid.toLowerCase());
      if (!snapshot) {
        errors.push(`${uuid}: no longer a snapshot this tool may delete`);
        continue;
      }
      const { code: delCode, stderr: delErr } = await run(
        `sudo diskutil apfs deleteSnapshot ${VOLUME} -uuid ${snapshot.uuid}`,
        { timeout: 60_000 },
      );
      if (delCode !== 0) {
        errors.push(`delete ${snapshot.uuid}: ${delErr}`);
        continue;
      }
      freed += r.size;
    }
    return { freed, errors };
  }
}
