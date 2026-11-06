import fsp from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HOME = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = mkdtempSync(join(tmpdir(), 'mdc-dup-home-'));
  process.env.HOME = home;
  return home;
});

vi.mock('ora', () => {
  const spinner = { start: () => spinner, succeed: () => spinner, fail: () => spinner };
  return { default: () => spinner };
});

import { duplicatesCommand } from './duplicates.js';

const logged = () =>
  vi
    .mocked(console.log)
    .mock.calls.map((c) => c.join(' '))
    .join('\n');

async function twins(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(`${dir}/one.bin`, 'same content here');
  await fsp.writeFile(`${dir}/two.bin`, 'same content here');
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  await fsp.rm(HOME, { recursive: true, force: true });
  await fsp.rm(`${HOME}ael`, { recursive: true, force: true });
});

describe('duplicates paths relative to HOME', () => {
  it('writes a file inside HOME as ~/...', async () => {
    await twins(`${HOME}/proj`);
    await duplicatesCommand(`${HOME}/proj`, { minSize: '1B' });
    expect(logged()).toContain('~/proj/one.bin');
  });

  it('prints a file in a sibling that only shares the HOME prefix in full', async () => {
    await twins(`${HOME}ael/proj`);
    await duplicatesCommand(`${HOME}ael/proj`, { minSize: '1B' });
    expect(logged()).toContain(`${HOME}ael/proj/one.bin`);
    expect(logged()).not.toContain('~ael');
  });
});
