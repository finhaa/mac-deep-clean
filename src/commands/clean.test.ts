import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spin = vi.hoisted(() => ({ failed: [] as string[] }));

vi.mock('ora', () => {
  const spinner = {
    start: () => spinner,
    succeed: () => spinner,
    fail: (text: string) => {
      spin.failed.push(text);
      return spinner;
    },
  };
  return { default: () => spinner };
});
vi.mock('@inquirer/prompts', () => ({ checkbox: vi.fn(), confirm: vi.fn() }));
vi.mock('../scanners/index.js', () => ({ getAllScanners: vi.fn() }));

import { checkbox, confirm } from '@inquirer/prompts';
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
  spin.failed.length = 0;
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

describe('cleanCommand --yes with irreversible categories', () => {
  const backups = () =>
    fakeScanner('ios-backups', 'moderate', [
      { ...item('ios-backups', 'moderate'), irreversible: true },
    ]);

  it('does not delete them for a broad --risky', async () => {
    const b = backups();
    vi.mocked(getAllScanners).mockReturnValue([safe, b] as never);
    await cleanCommand({ yes: true, risky: true });
    expect(b.clean).not.toHaveBeenCalled();
    expect(safe.clean).toHaveBeenCalledTimes(1);
  });

  it('deletes them when the category is named', async () => {
    const b = backups();
    vi.mocked(getAllScanners).mockReturnValue([safe, b] as never);
    await cleanCommand({ yes: true, category: 'ios-backups' });
    expect(cleanedLabels(b)).toEqual(['ios-backups-item']);
  });
});

describe('cleanCommand --yes skip message', () => {
  const logged = () =>
    vi
      .mocked(console.log)
      .mock.calls.map((c) => c.join(' '))
      .join('\n');
  const venv = () =>
    fakeScanner('project-artifacts', 'moderate', [
      { ...item('project-artifacts', 'moderate'), path: '/tmp/mdc-wiring/app/.venv' },
    ]);
  const backups = () =>
    fakeScanner('ios-backups', 'moderate', [
      { ...item('ios-backups', 'moderate'), irreversible: true },
    ]);

  it('says nothing when every item was picked', async () => {
    vi.mocked(getAllScanners).mockReturnValue([safe] as never);
    await cleanCommand({ yes: true });
    expect(logged()).not.toContain('Skipped');
  });

  it('offers --risky when it was not given', async () => {
    await cleanCommand({ yes: true });
    expect(logged()).toContain('Skipped 1 item(s) that are not safe');
    expect(logged()).toContain('or add --risky for the rest');
  });

  it('does not offer --risky when it was given', async () => {
    vi.mocked(getAllScanners).mockReturnValue([safe, backups()] as never);
    await cleanCommand({ yes: true, risky: true });
    expect(logged()).toContain(
      'Skipped 1 item(s) that are virtualenvs or need their own --category',
    );
    expect(logged()).not.toContain('--risky');
    expect(logged()).not.toContain('not safe');
  });

  it('does not ask for a category that was given', async () => {
    vi.mocked(getAllScanners).mockReturnValue([venv()] as never);
    await cleanCommand({ yes: true, category: 'project-artifacts' });
    expect(logged()).toContain('Skipped 1 item(s) that are virtualenvs.');
    expect(logged()).not.toContain('--risky');
    expect(logged()).not.toContain('their own --category');
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

describe('cleanCommand with items that have no measurable size', () => {
  const snapshot: ScanResult = {
    path: 'snapshots:one',
    size: 0,
    label: 'snapshot one',
    category: 'snap-cat',
    risk: 'moderate',
    virtual: true,
  };

  it('does not report "Nothing to clean" for a virtual item of size 0', async () => {
    const snaps = fakeScanner('snap-cat', 'moderate', [snapshot]);
    vi.mocked(getAllScanners).mockReturnValue([snaps] as never);

    await cleanCommand({ yes: true, category: 'snap-cat' });

    expect(cleanedLabels(snaps)).toEqual(['snapshot one']);
  });

  it('still hides a plain item of size 0, which is an empty folder', async () => {
    const empty = fakeScanner('empty-cat', 'safe', [
      {
        path: '/tmp/mdc-wiring/empty',
        size: 0,
        label: 'empty',
        category: 'empty-cat',
        risk: 'safe',
      },
    ]);
    vi.mocked(getAllScanners).mockReturnValue([empty] as never);

    await cleanCommand({ yes: true });

    expect(empty.clean).not.toHaveBeenCalled();
  });
});

const logged = () =>
  vi
    .mocked(console.log)
    .mock.calls.map((call) => call.join(' '))
    .join('\n');

describe('cleanCommand interactive', () => {
  beforeEach(() => {
    vi.mocked(checkbox).mockReset();
    vi.mocked(confirm).mockReset();
    vi.mocked(checkbox).mockResolvedValue([0] as never);
    vi.mocked(confirm).mockResolvedValue(true as never);
  });

  const choicesOf = (call: number) =>
    (vi.mocked(checkbox).mock.calls[call]?.[0] as unknown as { choices: { checked: boolean }[] })
      .choices;

  it('asks once per report and pre-ticks only the safe items', async () => {
    await cleanCommand({ risky: true });
    expect(vi.mocked(checkbox)).toHaveBeenCalledTimes(4);
    expect(choicesOf(0).map((c) => c.checked)).toEqual([true]);
    expect(choicesOf(1).map((c) => c.checked)).toEqual([false]);
    expect(choicesOf(3).map((c) => c.checked)).toEqual([true, false]);
  });

  it('does not offer risky items unless asked, not even from a safe scanner', async () => {
    await cleanCommand({});
    expect(vi.mocked(checkbox)).toHaveBeenCalledTimes(3);
    expect(choicesOf(2)).toHaveLength(1);
  });

  it('cleans what was picked once the user confirms', async () => {
    await cleanCommand({});
    expect(vi.mocked(confirm)).toHaveBeenCalledTimes(1);
    expect(cleanedLabels(safe)).toEqual(['safe-cat-item']);
    expect(cleanedLabels(moderate)).toEqual(['moderate-cat-item']);
    expect(cleanedLabels(mixed)).toEqual(['mixed-safe']);
  });

  it('defaults the confirmation to no', async () => {
    await cleanCommand({});
    expect(vi.mocked(confirm)).toHaveBeenCalledWith(expect.objectContaining({ default: false }));
  });

  it('cleans nothing when the user declines the confirmation', async () => {
    vi.mocked(confirm).mockResolvedValue(false as never);
    await cleanCommand({});
    for (const s of [safe, moderate, risky, mixed]) expect(s.clean).not.toHaveBeenCalled();
    expect(logged()).toContain('Cancelled');
  });

  it('does not ask for confirmation on a dry run', async () => {
    await cleanCommand({ dryRun: true });
    expect(vi.mocked(confirm)).not.toHaveBeenCalled();
    expect(safe.clean.mock.calls[0]?.[1]).toBe(true);
  });

  it('stops without asking to confirm when nothing was picked', async () => {
    vi.mocked(checkbox).mockResolvedValue([] as never);
    await cleanCommand({});
    expect(vi.mocked(confirm)).not.toHaveBeenCalled();
    for (const s of [safe, moderate, risky, mixed]) expect(s.clean).not.toHaveBeenCalled();
    expect(logged()).toContain('Nothing selected');
  });
});

describe('cleanCommand reporting', () => {
  it('lists items this tool cannot clean and never tries to clean them', async () => {
    const vm: ScanResult = { ...item('vm-cat', 'safe', 'VM disk'), cleanable: false };
    const vmScanner = fakeScanner('vm-cat', 'safe', [vm]);
    vi.mocked(getAllScanners).mockReturnValue([vmScanner, safe] as never);
    await cleanCommand({ yes: true });
    expect(logged()).toContain('Not cleanable by this tool');
    expect(logged()).toContain('VM disk');
    expect(vmScanner.clean).not.toHaveBeenCalled();
    expect(cleanedLabels(safe)).toEqual(['safe-cat-item']);
  });

  it('keeps cleaning the other categories when one scanner throws, and says so', async () => {
    safe.clean.mockRejectedValue(new Error('disk on fire'));
    await cleanCommand({ yes: true, risky: true });
    expect(cleanedLabels(moderate)).toEqual(['moderate-cat-item']);
    expect(logged()).toContain('disk on fire');
  });

  it('prints the errors a scanner returns and still says Done', async () => {
    safe.clean.mockResolvedValue({ freed: 10, errors: ['/x: EACCES'] });
    await cleanCommand({ yes: true });
    expect(logged()).toContain('/x: EACCES');
    expect(logged()).toContain('Done.');
  });

  it('strips terminal control characters from the errors it prints', async () => {
    safe.clean.mockResolvedValue({ freed: 0, errors: ['/x/\u001b[2K\rname: EACCES'] });
    await cleanCommand({ yes: true });
    expect(logged()).toContain('/x/?[2K?name: EACCES');
    expect(logged()).not.toContain('\u001b');
  });

  it('skips an item whose category no scanner owns instead of crashing', async () => {
    const stray = fakeScanner('stray', 'safe', [item('ghost', 'safe', 'ghost-item')]);
    vi.mocked(getAllScanners).mockReturnValue([stray, safe] as never);
    await cleanCommand({ yes: true });
    expect(stray.clean).not.toHaveBeenCalled();
    expect(cleanedLabels(safe)).toEqual(['safe-cat-item']);
    expect(logged()).toContain('Done.');
  });

  it('labels a dry run as one', async () => {
    await cleanCommand({ yes: true, dryRun: true });
    expect(logged()).toContain('dry run');
  });

  it('says there is nothing to clean when every scanner is empty', async () => {
    vi.mocked(getAllScanners).mockReturnValue([fakeScanner('empty', 'safe', [])] as never);
    await cleanCommand({ yes: true });
    expect(logged()).toContain('Nothing to clean');
  });
});

describe('cleanCommand output', () => {
  it('prints no control characters from the description of a not cleanable item', async () => {
    const info: ScanResult = {
      ...item('info-cat', 'safe', 'vm disk'),
      cleanable: false,
      description: 'vm\u001b[2Jz',
    };
    vi.mocked(getAllScanners).mockReturnValue([fakeScanner('info-cat', 'safe', [info])] as never);
    await cleanCommand({ yes: true });
    const out = vi
      .mocked(console.log)
      .mock.calls.map((c) => c.join(' '))
      .join('\n');
    expect(out).toContain('vm');
    expect(out).not.toContain('\u001b[2J');
  });
});

describe('cleanCommand terminal safety', () => {
  const EVIL = 'Evil\u001b[2K\rLabel';
  const logged = () =>
    vi
      .mocked(console.log)
      .mock.calls.map((c) => c.join(' '))
      .join('\n');

  it('strips control characters from the label of an item it cannot clean', async () => {
    const info = { ...item('safe-cat', 'safe', EVIL), cleanable: false as const };
    vi.mocked(getAllScanners).mockReturnValue([fakeScanner('safe-cat', 'safe', [info])] as never);
    await cleanCommand({ yes: true, dryRun: true });
    expect(logged()).toContain('Evil?[2K?Label');
    expect(logged()).not.toContain('\u001b[2K');
    expect(logged()).not.toContain('\r');
  });

  it('strips control characters from a label in the picker', async () => {
    vi.mocked(getAllScanners).mockReturnValue([
      fakeScanner('safe-cat', 'safe', [item('safe-cat', 'safe', EVIL)]),
    ] as never);
    vi.mocked(checkbox).mockReset();
    vi.mocked(checkbox).mockResolvedValue([] as never);
    await cleanCommand({});
    const { choices } = vi.mocked(checkbox).mock.calls[0]?.[0] as unknown as {
      choices: { name: string }[];
    };
    expect(choices[0]?.name).toContain('Evil?[2K?Label');
    expect(choices[0]?.name).not.toContain('\u001b[2K');
    expect(choices[0]?.name).not.toContain('\r');
  });

  it('strips control characters from the error a scanner throws, on the spinner and in the report', async () => {
    const broken = fakeScanner('safe-cat', 'safe', [item('safe-cat', 'safe')]);
    broken.clean.mockRejectedValue(new Error(`boom${EVIL}`));
    vi.mocked(getAllScanners).mockReturnValue([broken] as never);
    await cleanCommand({ yes: true });
    expect(spin.failed.join('\n')).toContain('boomEvil?[2K?Label');
    expect(spin.failed.join('\n')).not.toContain('\u001b[2K');
    expect(spin.failed.join('\n')).not.toContain('\r');
    expect(logged()).not.toContain('\u001b[2K');
    expect(logged()).not.toContain('\r');
  });
});
