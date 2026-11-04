import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// The classification reads HOME when paths.js loads, so pin it before any import.
const HOME = vi.hoisted(() => {
  process.env.HOME = '/Users/testuser';
  return '/Users/testuser';
});

import { addPermissionWarning, flushWarnings, hasWarnings } from './warnings.js';

const MB = 1024 * 1024;
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

describe('permission warnings', () => {
  it('stay quiet below the noise threshold', () => {
    addPermissionWarning(path.join(HOME, 'Library/Mail'), 99 * MB);
    expect(hasWarnings()).toBe(true);
    expect(flushWarnings()).toEqual([]);
    expect(hasWarnings()).toBe(false);
  });

  it('point to Full Disk Access for ~/Library paths', () => {
    addPermissionWarning(path.join(HOME, 'Library/Mail'), 150 * MB);
    const [message] = flushWarnings();
    expect(message).toContain('Full Disk Access');
    expect(message).toContain('~/Library/Mail');
  });

  it('classify by whole folders, not by a shared name prefix', () => {
    addPermissionWarning(`${HOME}ael/Library/Mail`, 150 * MB);
    addPermissionWarning('/LibraryX/cache', 150 * MB);
    addPermissionWarning('/usrlocal/x', 150 * MB);
    addPermissionWarning(`${HOME}/LibraryBackup/x`, 150 * MB);
    const messages = flushWarnings();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('4 other path(s) were unreadable');
  });

  it
    .skipIf(isRoot)
    .each(['/Library/Caches/x', '/private/var/db/x', '/System/Library/x', '/usr/local/x'])(
    'send %s to sudo',
    (target) => {
      addPermissionWarning(target, 150 * MB);
      const [message] = flushWarnings();
      expect(message).toContain('root-owned');
    },
  );

  it('show a sibling of HOME in full instead of cutting it to ~...', () => {
    addPermissionWarning(`${HOME}ael/data`, 150 * MB);
    const [message] = flushWarnings();
    expect(message).toContain(`${HOME}ael/data`);
    expect(message).not.toContain('~ael');
  });

  it.skipIf(isRoot)('point to sudo for system paths', () => {
    addPermissionWarning('/Library/Caches/com.example', 150 * MB);
    const [message] = flushWarnings();
    expect(message).toContain('root-owned');
    expect(message).toContain('sudo');
  });

  it('report anything else as unreadable and list at most three paths', () => {
    for (const n of [1, 2, 3, 4, 5]) addPermissionWarning(`/Volumes/disk/dir${n}`, 30 * MB);
    const [message] = flushWarnings();
    expect(message).toContain('5 other path(s) were unreadable');
    expect(message).toContain('(+2 more)');
  });

  it('print a path with control characters as plain text', () => {
    addPermissionWarning('/Volumes/disk/evil\u001b[2Jname', 150 * MB);
    const [message] = flushWarnings();
    expect(message).toContain('evil');
    expect(message).not.toContain('\u001b[2J');
  });

  it('are cleared once flushed', () => {
    addPermissionWarning('/Volumes/disk/x', 500 * MB);
    flushWarnings();
    expect(flushWarnings()).toEqual([]);
  });
});
