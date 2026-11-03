import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ora', () => {
  const spinner = { start: () => spinner, succeed: () => spinner, fail: () => spinner };
  return { default: () => spinner };
});
vi.mock('@inquirer/prompts', () => ({ checkbox: vi.fn(), confirm: vi.fn() }));
vi.mock('../scanners/index.js', () => ({ getAllScanners: vi.fn() }));

import { getAllScanners } from '../scanners/index.js';
import type { Risk, ScanResult } from '../types.js';
import { cleanCommand } from './clean.js';

function item(category: string, risk: Risk, label = `${category}-item`): ScanResult {
  return { path: `/tmp/mdc-wiring/${label}`, size: 1000, label, category, risk };
}

function fakeScanner(category: string, risk: Risk, items: ScanResult[]) {
  return {
    name: category,
    category,
    description: category,
    risk,
    scan: vi.fn(async () => items),
    clean: vi.fn(async (done: ScanResult[], _dryRun?: boolean) => ({
      freed: done.reduce((s, r) => s + r.size, 0),
      errors: [] as string[],
    })),
  };
}

let safe: ReturnType<typeof fakeScanner>;
let moderate: ReturnType<typeof fakeScanner>;
let risky: ReturnType<typeof fakeScanner>;
let mixed: ReturnType<typeof fakeScanner>;

beforeEach(() => {
  safe = fakeScanner('safe-cat', 'safe', [item('safe-cat', 'safe')]);
  moderate = fakeScanner('moderate-cat', 'moderate', [item('moderate-cat', 'moderate')]);
  risky = fakeScanner('risky-cat', 'risky', [item('risky-cat', 'risky')]);
  mixed = fakeScanner('mixed-cat', 'safe', [
    item('mixed-cat', 'safe', 'mixed-safe'),
    item('mixed-cat', 'risky', 'mixed-risky'),
  ]);
  vi.mocked(getAllScanners).mockReturnValue([safe, moderate, risky, mixed] as never);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

const cleanedLabels = (s: ReturnType<typeof fakeScanner>) =>
  s.clean.mock.calls.flatMap(([items]) => items.map((i) => i.label));

describe('cleanCommand --yes', () => {
  it('cleans only safe items and never touches moderate or risky ones', async () => {
    await cleanCommand({ yes: true });

    expect(cleanedLabels(safe)).toEqual(['safe-cat-item']);
    expect(moderate.clean).not.toHaveBeenCalled();
    expect(risky.clean).not.toHaveBeenCalled();
  });

  it('does not even scan a risky scanner unless asked', async () => {
    await cleanCommand({ yes: true });
    expect(risky.scan).not.toHaveBeenCalled();
  });

  it('drops a risky item reported by a scanner that is itself safe', async () => {
    await cleanCommand({ yes: true });
    expect(cleanedLabels(mixed)).toEqual(['mixed-safe']);
  });

  it('cleans moderate and risky items too when --risky is passed', async () => {
    await cleanCommand({ yes: true, risky: true });

    expect(cleanedLabels(moderate)).toEqual(['moderate-cat-item']);
    expect(cleanedLabels(risky)).toEqual(['risky-cat-item']);
    expect(cleanedLabels(mixed)).toEqual(['mixed-safe', 'mixed-risky']);
  });

  it('treats an explicit --category as the opt-in, even for a risky scanner', async () => {
    await cleanCommand({ yes: true, category: 'risky-cat' });

    expect(cleanedLabels(risky)).toEqual(['risky-cat-item']);
    expect(safe.scan).not.toHaveBeenCalled();
    expect(safe.clean).not.toHaveBeenCalled();
  });
});

describe('cleanCommand other paths', () => {
  it('passes dry-run through to every scanner clean', async () => {
    await cleanCommand({ yes: true, dryRun: true });
    expect(safe.clean).toHaveBeenCalledTimes(1);
    expect(safe.clean.mock.calls[0]?.[1]).toBe(true);
  });

  it('passes dryRun false on a real run', async () => {
    await cleanCommand({ yes: true });
    expect(safe.clean.mock.calls[0]?.[1]).toBe(false);
  });

  it('fails on an unknown category without scanning anything', async () => {
    await cleanCommand({ yes: true, category: 'nope' });

    expect(process.exitCode).toBe(1);
    for (const s of [safe, moderate, risky, mixed]) expect(s.scan).not.toHaveBeenCalled();
  });
});
