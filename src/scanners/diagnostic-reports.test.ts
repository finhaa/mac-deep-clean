import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  size: 0,
  cleared: { freed: 0, errors: [] as string[] },
}));

vi.mock('../utils/fs.js', () => ({
  pathExists: vi.fn(async () => true),
  getSize: vi.fn(async () => fsMock.size),
  canWriteDir: vi.fn(async () => true),
  clearDir: vi.fn(async () => fsMock.cleared),
}));

import { clearDir } from '../utils/fs.js';
import { DiagnosticReportsScanner } from './diagnostic-reports.js';

const target = { path: '/x/DiagnosticReports', label: 'Reports' };

function scanner(): DiagnosticReportsScanner {
  const s = new DiagnosticReportsScanner();
  s.targets = [target];
  return s;
}

const item = {
  path: target.path,
  size: 900,
  label: target.label,
  category: 'diagnostic-reports',
  risk: 'safe' as const,
};

beforeEach(() => {
  vi.mocked(clearDir).mockClear();
  fsMock.size = 0;
  fsMock.cleared = { freed: 0, errors: [] };
});

describe('DiagnosticReportsScanner', () => {
  it('skips a folder with nothing in it', async () => {
    fsMock.size = 0;
    expect(await scanner().scan()).toEqual([]);
  });

  it('reports a folder that holds something', async () => {
    fsMock.size = 5;
    expect((await scanner().scan()).map((r) => r.size)).toEqual([5]);
  });

  it('reports a folder that holds a single byte', async () => {
    fsMock.size = 1;
    expect((await scanner().scan()).map((r) => r.size)).toEqual([1]);
  });

  it('reports what was really freed, not what the scan expected', async () => {
    fsMock.cleared = { freed: 123, errors: [] };
    expect((await scanner().clean([item])).freed).toBe(123);
  });

  it('passes on the errors of the delete', async () => {
    fsMock.cleared = { freed: 0, errors: ['boom'] };
    expect((await scanner().clean([item])).errors).toEqual(['boom']);
  });

  it('deletes nothing on a dry run and reports the planned size', async () => {
    const { freed } = await scanner().clean([item], true);
    expect(clearDir).not.toHaveBeenCalled();
    expect(freed).toBe(900);
  });
});
