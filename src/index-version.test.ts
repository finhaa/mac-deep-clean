import { describe, expect, it, vi } from 'vitest';

vi.mock('node:module', () => ({ createRequire: () => () => ({ version: '9.9.9-test' }) }));
vi.mock('./commands/clean.js', () => ({ cleanCommand: vi.fn() }));
vi.mock('./commands/doctor.js', () => ({ doctorCommand: vi.fn() }));
vi.mock('./commands/duplicates.js', () => ({ duplicatesCommand: vi.fn() }));
vi.mock('./commands/purge.js', () => ({ purgeCommand: vi.fn() }));
vi.mock('./commands/scan.js', () => ({ scanCommand: vi.fn() }));

describe('--version', () => {
  it('prints whatever version package.json holds, so no literal is hard coded', async () => {
    const realArgv = process.argv;
    process.argv = ['node', 'mac-deep-clean', '--version'];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    try {
      await import('./index.js');
      await new Promise((resolve) => setImmediate(resolve));
      expect(write.mock.calls.map((c) => String(c[0])).join('')).toContain('9.9.9-test');
    } finally {
      write.mockRestore();
      exit.mockRestore();
      process.argv = realArgv;
    }
  });
});
