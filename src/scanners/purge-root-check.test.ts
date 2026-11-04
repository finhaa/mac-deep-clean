import fsp from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

// The protected list is built from HOME when the module loads, so HOME is set before any import.
const h = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const nodePath = await import('node:path');
  const original = process.env.HOME;
  const home = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'mdc-root-check-'));
  process.env.HOME = home;
  return { home, original };
});

import { checkPurgeRoot } from './project-artifacts.js';

const home = (...parts: string[]) => path.join(h.home, ...parts);

afterAll(async () => {
  if (h.original !== undefined) process.env.HOME = h.original;
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
