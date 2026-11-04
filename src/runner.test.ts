import { describe, expect, it, vi } from 'vitest';

const spinner = vi.hoisted(() => ({
  start: vi.fn(),
  succeed: vi.fn(),
  fail: vi.fn(),
}));
vi.mock('ora', () => {
  spinner.start.mockReturnValue(spinner);
  return { default: () => spinner };
});

import { runScanners } from './runner.js';

const scanner = (scan: () => Promise<never[]>) =>
  ({ name: 'N', category: 'c', description: 'd', risk: 'safe', scan, clean: vi.fn() }) as never;

describe('runScanners', () => {
  it('keeps going after a scanner throws and records its error', async () => {
    const reports = await runScanners([
      scanner(async () => {
        throw new Error('exploded');
      }),
      scanner(async () => []),
    ]);
    expect(reports.map((r) => r.error)).toEqual(['exploded', undefined]);
  });

  it('prints a scanner error without control characters', async () => {
    await runScanners([
      scanner(async () => {
        throw new Error('bad\u001b[2Jpath');
      }),
    ]);
    const shown = String(spinner.fail.mock.calls.at(-1)?.[0]);
    expect(shown).toContain('bad');
    expect(shown).not.toContain('\u001b[2J');
  });
});
