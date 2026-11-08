import { describe, expect, it, vi } from 'vitest';

const sized = vi.hoisted(() => ({ bytes: 0 }));

vi.mock('../utils/fs.js', () => ({
  pathExists: vi.fn(async () => true),
  isDirectory: vi.fn(async () => true),
  sizeExcluding: vi.fn(async () => sized.bytes),
  getSize: vi.fn(async () => 5),
  clearDir: vi.fn(async () => ({ freed: 7, errors: ['denied: /x/Logs/a'] })),
}));

import { LogsScanner } from './logs.js';

describe('LogsScanner.clean', () => {
  it('passes on the errors of the delete and reports what was freed', async () => {
    const result = await new LogsScanner().clean([
      { path: '/x/Logs', size: 900, label: 'Logs', category: 'logs', risk: 'safe' },
    ]);
    expect(result.errors).toEqual(['denied: /x/Logs/a']);
    expect(result.freed).toBe(7);
  });
});

describe('LogsScanner.scan', () => {
  it('draws the 10 MB line at the byte', async () => {
    const scanner = new LogsScanner();
    scanner.targets = [{ path: '/x/Logs', label: 'User logs' }];
    sized.bytes = 10 * 1024 * 1024 - 1;
    expect(await scanner.scan()).toEqual([]);
    sized.bytes = 10 * 1024 * 1024;
    expect((await scanner.scan()).map((r) => r.size)).toEqual([10 * 1024 * 1024]);
    sized.bytes = 10 * 1024 * 1024 + 1;
    expect((await scanner.scan()).map((r) => r.size)).toEqual([10 * 1024 * 1024 + 1]);
  });
});
