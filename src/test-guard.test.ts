import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('vitest.setup.ts delete guard', () => {
  // Only paths that do not exist: if the guard regressed, this test must still delete nothing.
  it.each(['/usr/bin/mdc-never-here', path.join(os.homedir(), 'mdc-never-here')])(
    'refuses to delete %s',
    async (target) => {
      await expect(fsp.rm(target, { recursive: true, force: true })).rejects.toThrow(/test guard/);
      await expect(fsp.unlink(target)).rejects.toThrow(/test guard/);
      expect(() => fs.rmSync(target, { recursive: true, force: true })).toThrow(/test guard/);
    },
  );

  it('still deletes inside the temp dir', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-guard-'));
    await fsp.rm(dir, { recursive: true, force: true });
    await expect(fsp.stat(dir)).rejects.toThrow();
  });
});
