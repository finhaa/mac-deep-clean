import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addPermissionWarning, flushWarnings, hasWarnings } from './warnings.js';

const MB = 1024 * 1024;
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

describe('permission warnings', () => {
  it('stay quiet below the noise threshold', () => {
    addPermissionWarning(path.join(os.homedir(), 'Library/Mail'), 99 * MB);
    expect(hasWarnings()).toBe(true);
    expect(flushWarnings()).toEqual([]);
    expect(hasWarnings()).toBe(false);
  });

  it('point to Full Disk Access for ~/Library paths', () => {
    addPermissionWarning(path.join(os.homedir(), 'Library/Mail'), 150 * MB);
    const [message] = flushWarnings();
    expect(message).toContain('Full Disk Access');
    expect(message).toContain('~/Library/Mail');
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

  it('are cleared once flushed', () => {
    addPermissionWarning('/Volumes/disk/x', 500 * MB);
    flushWarnings();
    expect(flushWarnings()).toEqual([]);
  });
});
