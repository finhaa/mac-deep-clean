import { describe, expect, it } from 'vitest';
import { getAllScanners } from './index.js';

// The tier decides what `clean`, `clean --risky` and `clean --yes` pick, so a change must fail here first.
const TIERS: Record<string, 'safe' | 'moderate' | 'risky'> = {
  android: 'moderate',
  'apfs-snapshots': 'moderate',
  containers: 'moderate',
  'browser-cache': 'safe',
  'dev-cache': 'safe',
  docker: 'risky',
  'diagnostic-reports': 'safe',
  electron: 'safe',
  homebrew: 'safe',
  jetbrains: 'moderate',
  'git-tmp-packs': 'moderate',
  'ios-simulators': 'safe',
  'ios-backups': 'moderate',
  'launch-agents': 'moderate',
  logs: 'safe',
  'mail-downloads': 'moderate',
  'music-creation': 'moderate',
  'project-artifacts': 'moderate',
  'screen-recording': 'moderate',
  'saved-app-state': 'safe',
  spotify: 'safe',
  'system-cache': 'moderate',
  'time-machine': 'moderate',
  'temp-files': 'moderate',
  'user-cache': 'safe',
  trash: 'moderate',
  wallpaper: 'safe',
};

describe('scanner risk tiers', () => {
  const scanners = getAllScanners();

  it('covers every scanner, so a new one must pick a tier here', () => {
    expect(scanners.map((s) => s.category).sort()).toEqual(Object.keys(TIERS).sort());
  });

  it.each(Object.entries(TIERS))('%s is %s', (category, tier) => {
    expect(scanners.find((s) => s.category === category)?.risk).toBe(tier);
  });
});
