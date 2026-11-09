import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ writable: new Set<string>() }));

vi.mock('../utils/fs.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/fs.js')>()),
  pathExists: vi.fn(async () => true),
  isDirectory: vi.fn(async () => true),
  getSize: vi.fn(async () => 500 * 1024 * 1024),
  sizeExcluding: vi.fn(async () => 500 * 1024 * 1024),
  canWriteDir: vi.fn(async (p: string) => h.writable.has(p)),
}));

import { HOME } from '../utils/paths.js';
import { DiagnosticReportsScanner } from './diagnostic-reports.js';
import { LogsScanner } from './logs.js';
import { MusicCreationScanner } from './music-creation.js';

beforeEach(() => {
  h.writable.clear();
});

describe('folders a run without sudo cannot delete from are not offered', () => {
  it('LogsScanner offers a logs folder only when it can remove its entries', async () => {
    const s = new LogsScanner();
    s.targets = [{ path: '/x/Logs', label: 'System logs' }];
    expect(await s.scan()).toEqual([]);
    h.writable.add('/x/Logs');
    expect((await s.scan()).map((r) => r.path)).toEqual(['/x/Logs']);
  });

  it('DiagnosticReportsScanner offers a reports folder only when it can remove its entries', async () => {
    const s = new DiagnosticReportsScanner();
    s.targets = [{ path: '/x/DiagnosticReports', label: 'Reports' }];
    expect(await s.scan()).toEqual([]);
    h.writable.add('/x/DiagnosticReports');
    expect((await s.scan()).map((r) => r.path)).toEqual(['/x/DiagnosticReports']);
  });

  it('MusicCreationScanner offers a library only when it can remove it from its parent', async () => {
    const support = path.join(HOME, 'Library/Application Support');
    h.writable.add(support);
    expect((await new MusicCreationScanner().scan()).map((r) => r.path)).toEqual([
      path.join(support, 'GarageBand'),
      path.join(support, 'Logic'),
    ]);
    h.writable.add('/Library/Audio');
    expect((await new MusicCreationScanner().scan()).map((r) => r.path)).toContain(
      '/Library/Audio/Apple Loops',
    );
  });
});
