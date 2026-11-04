import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TempFilesScanner, tempCandidates } from './temp-files.js';

const DAY_MS = 24 * 60 * 60 * 1000;
let dir: string | undefined;

afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('tempCandidates', () => {
  it('offers only the per-user temp dir, never /tmp or /private/tmp', () => {
    const candidates = tempCandidates('/var/folders/ab/cd/T');
    expect(candidates.map((c) => c.path)).toEqual(['/var/folders/ab/cd/T']);
  });

  it('offers the macOS per-user temp dir under either spelling of /var', () => {
    expect(tempCandidates('/private/var/folders/ab/cd/T').map((c) => c.path)).toEqual([
      '/private/var/folders/ab/cd/T',
    ]);
    expect(tempCandidates('/var/folders/ab/cd/T/').map((c) => c.path)).toHaveLength(1);
  });

  it.each([
    '/tmp',
    '/private/tmp',
    '/Users/me',
    '/Users/me/Documents/T',
    '/var/folders/ab/cd',
    '/var/folders/ab/cd/T/sub',
    '/',
  ])('does not trust %s just because $TMPDIR points there', (dirPath) => {
    expect(tempCandidates(dirPath)).toEqual([]);
  });

  it('says the size is an upper bound, since only old user-owned files go', () => {
    const [candidate] = tempCandidates('/var/folders/ab/cd/T');
    expect(candidate?.description).toContain('at most');
  });

  it('does not claim to skip files that are in use, since find -delete does not check', () => {
    for (const c of tempCandidates('/var/folders/ab/cd/T')) {
      expect(c.description.toLowerCase()).not.toContain('in use');
    }
  });
});

describe('TempFilesScanner', () => {
  it('reports as freed only the bytes of files it actually deleted', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdc-temp-'));
    const oldFile = path.join(dir, 'old.bin');
    const newFile = path.join(dir, 'new.bin');
    await fs.writeFile(oldFile, Buffer.alloc(1000));
    await fs.writeFile(newFile, Buffer.alloc(50_000));
    const threeDaysAgo = new Date(Date.now() - 3 * DAY_MS);
    await fs.utimes(oldFile, threeDaysAgo, threeDaysAgo);

    const scanner = new TempFilesScanner();
    const { freed, errors } = await scanner.clean(
      [
        {
          path: dir,
          size: 51_000,
          label: 'test',
          category: 'temp-files',
          risk: 'moderate',
          description: 'test',
        },
      ],
      false,
    );

    expect(errors).toEqual([]);
    await expect(fs.stat(oldFile)).rejects.toThrow();
    await expect(fs.stat(newFile)).resolves.toBeDefined();
    expect(freed).toBeGreaterThan(0);
    expect(freed).toBeLessThan(50_000);
  });

  it('deletes nothing on a dry run and reports the planned size', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdc-temp-'));
    const oldFile = path.join(dir, 'old.bin');
    await fs.writeFile(oldFile, Buffer.alloc(1000));
    const threeDaysAgo = new Date(Date.now() - 3 * DAY_MS);
    await fs.utimes(oldFile, threeDaysAgo, threeDaysAgo);
    const result = {
      path: dir,
      size: 4242,
      label: 'test',
      category: 'temp-files',
      risk: 'moderate' as const,
    };
    const { freed, errors } = await new TempFilesScanner().clean([result], true);
    expect(errors).toEqual([]);
    expect(freed).toBe(4242);
    await expect(fs.stat(oldFile)).resolves.toBeDefined();
  });

  it('refuses a path the guard protects and frees nothing', async () => {
    // dry run: if the guard ever regressed, a real run would execute `find /tmp -delete`
    const { freed, errors } = await new TempFilesScanner().clean(
      [{ path: '/tmp', size: 99, label: 'tmp', category: 'temp-files', risk: 'moderate' as const }],
      true,
    );
    expect(freed).toBe(0);
    expect(errors[0]).toContain('near-root');
  });

  it('refuses a temp dir that reaches a protected path through a symlinked parent', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdc-temp-'));
    await fs.symlink('/usr', path.join(dir, 'link'));
    const { freed, errors } = await new TempFilesScanner().clean(
      [
        {
          path: path.join(dir, 'link', 'bin'),
          size: 5,
          label: 'x',
          category: 'temp-files',
          risk: 'moderate',
        },
      ],
      true,
    );
    expect(freed).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('protected');
  });

  it('filters by the real account, not by whatever $USER says', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdc-temp-'));
    const oldFile = path.join(dir, 'old.bin');
    await fs.writeFile(oldFile, Buffer.alloc(1000));
    const threeDaysAgo = new Date(Date.now() - 3 * DAY_MS);
    await fs.utimes(oldFile, threeDaysAgo, threeDaysAgo);
    vi.stubEnv('USER', 'someone"; touch /tmp/mdc-pwned; "');

    const { freed, errors } = await new TempFilesScanner().clean(
      [{ path: dir, size: 1000, label: 'x', category: 'temp-files', risk: 'moderate' }],
      false,
    );
    vi.unstubAllEnvs();

    expect(errors).toEqual([]);
    expect(freed).toBeGreaterThan(0);
    await expect(fs.stat(oldFile)).rejects.toThrow();
  });
});
