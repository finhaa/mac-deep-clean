import { describe, expect, it, vi } from 'vitest';

// A HOME under /private (a temp or fake home) must still read as the user's Library, not as a system path.
const HOME = vi.hoisted(() => {
  process.env.HOME = '/private/var/tmp/mdc-home';
  return '/private/var/tmp/mdc-home';
});

import { addPermissionWarning, flushWarnings } from './warnings.js';

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

describe('permission warnings with a HOME under /private', () => {
  it('still point to Full Disk Access for ~/Library paths', () => {
    addPermissionWarning(`${HOME}/Library/Mail`, 150 * 1024 * 1024);
    const [message] = flushWarnings();
    expect(message).toContain('Full Disk Access');
    expect(message).toContain('~/Library/Mail');
  });

  it.skipIf(isRoot)('keep /private outside HOME as a system path', () => {
    addPermissionWarning('/private/etc/x', 150 * 1024 * 1024);
    const [message] = flushWarnings();
    expect(message).toContain('root-owned');
  });
});
