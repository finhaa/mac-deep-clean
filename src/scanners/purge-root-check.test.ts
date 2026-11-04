import fsp from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ home: '' }));

vi.mock('../utils/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/paths.js')>();
  const os = await import('node:os');
  const fs = await import('node:fs');
  const nodePath = await import('node:path');
  h.home = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'mdc-root-check-'));
  return { ...actual, HOME: h.home };
});

import { checkPurgeRoot } from './project-artifacts.js';

const home = (...parts: string[]) => path.join(h.home, ...parts);

afterAll(async () => {
  await fsp.rm(h.home, { recursive: true, force: true });
});

describe('checkPurgeRoot', () => {
  it('returns the real folder and no problem for a plain project folder', async () => {
    await fsp.mkdir(home('code/app'), { recursive: true });
    expect(await checkPurgeRoot(home('code/app'))).toEqual({
      real: await fsp.realpath(home('code/app')),
      problem: null,
    });
  });

  it('follows a symlinked parent to the real folder', async () => {
    await fsp.mkdir(home('real/child'), { recursive: true });
    await fsp.symlink(home('real'), home('link'));
    const { real } = await checkPurgeRoot(home('link/child'));
    expect(real).toBe(await fsp.realpath(home('real/child')));
  });

  it('refuses a root that really lands in a protected folder', async () => {
    await fsp.symlink('/usr', home('usr-link'));
    const { real, problem } = await checkPurgeRoot(home('usr-link/bin'));
    expect(real).toBe(await fsp.realpath('/usr/bin'));
    expect(problem).toContain('protected path');
  });

  it('refuses a protected spelling even when a symlink moves it somewhere unprotected', async () => {
    await fsp.mkdir(home('elsewhere/proj'), { recursive: true });
    await fsp.symlink(home('elsewhere'), home('Documents'));
    const { real, problem } = await checkPurgeRoot(home('Documents/proj'));
    expect(real).toBe(await fsp.realpath(home('elsewhere/proj')));
    expect(problem).toContain('protected path');
  });
});
