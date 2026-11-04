import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/fs.js', () => ({
  pathExists: vi.fn(async () => true),
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
