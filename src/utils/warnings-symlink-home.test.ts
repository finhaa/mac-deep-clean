import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const MB = 1024 * 1024;

describe('a permission warning under a HOME spelled through a symlink', () => {
  it('points to Full Disk Access for the real Library behind it', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-warn-link-'));
    try {
      await fsp.mkdir(path.join(dir, 'real'));
      await fsp.symlink(path.join(dir, 'real'), path.join(dir, 'link'));
      vi.resetModules();
      vi.stubEnv('HOME', path.join(dir, 'link'));
      const { addPermissionWarning, flushWarnings } = await import('./warnings.js');
      const real = await fsp.realpath(path.join(dir, 'real'));
      addPermissionWarning(path.join(real, 'Library/Mail'), 150 * MB);
      expect(flushWarnings()[0]).toContain('Full Disk Access');
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
