import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DiagnosticReportsScanner } from './diagnostic-reports.js';
import { LogsScanner } from './logs.js';

const MB = 1024 * 1024;
let root: string;

async function write(rel: string, bytes: number): Promise<void> {
  const file = path.join(root, rel);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, Buffer.alloc(bytes));
}

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-logs-'));
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

describe('LogsScanner', () => {
  async function scanner(): Promise<LogsScanner> {
    await write('Logs/app.log', 11 * MB);
    await write('Logs/DiagnosticReports/crash.ips', 12 * MB);
    await write('Logs/JetBrains/idea/idea.log', 13 * MB);
    const s = new LogsScanner();
    s.targets = [{ path: path.join(root, 'Logs'), label: 'User logs' }];
    return s;
  }

  it('counts only what no other scanner owns', async () => {
    const [item] = await (await scanner()).scan();
    expect(item?.size).toBeGreaterThan(10 * MB);
    expect(item?.size).toBeLessThan(12 * MB);
  });

  it('empties the folder, keeps the folder itself and leaves the folders other scanners own', async () => {
    const s = await scanner();
    const items = await s.scan();
    const { freed, errors } = await s.clean(items);
    expect(errors).toEqual([]);
    expect(freed).toBeGreaterThan(10 * MB);
    expect(freed).toBeLessThan(12 * MB);
    expect((await fsp.readdir(path.join(root, 'Logs'))).sort()).toEqual([
      'DiagnosticReports',
      'JetBrains',
    ]);
  });

  it('removes nothing on a dry run', async () => {
    const s = await scanner();
    const items = await s.scan();
    await s.clean(items, true);
    expect((await fsp.readdir(path.join(root, 'Logs'))).sort()).toEqual([
      'DiagnosticReports',
      'JetBrains',
      'app.log',
    ]);
  });
});

describe('DiagnosticReportsScanner', () => {
  it('empties the reports folder and keeps the folder itself', async () => {
    await write('DiagnosticReports/a.ips', 2 * MB);
    await write('DiagnosticReports/b.ips', 3 * MB);
    const s = new DiagnosticReportsScanner();
    s.targets = [{ path: path.join(root, 'DiagnosticReports'), label: 'User DiagnosticReports' }];
    const items = await s.scan();
    const { freed, errors } = await s.clean(items);
    expect(errors).toEqual([]);
    expect(freed).toBeGreaterThan(4 * MB);
    expect(await fsp.readdir(path.join(root, 'DiagnosticReports'))).toEqual([]);
  });
});
