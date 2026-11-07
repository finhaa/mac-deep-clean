import { promisify } from 'node:util';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// commandExists gives its shell 2 s; a loaded machine can take longer, so no real shell runs here.
const fake = vi.hoisted(() => ({
  seen: [] as Array<{ command: string; timeout?: number }>,
  next: null as Error | null,
}));

vi.mock('node:child_process', () => {
  const exec = Object.assign(() => undefined, {
    [promisify.custom]: async (command: string, options: { timeout?: number }) => {
      fake.seen.push({ command, timeout: options.timeout });
      if (fake.next) throw fake.next;
      return { stdout: '/usr/bin/node\n', stderr: '' };
    },
  });
  return { exec };
});

import { commandExists } from './exec.js';

beforeEach(() => {
  fake.seen = [];
  fake.next = null;
});

describe('commandExists', () => {
  it('asks the shell with command -v and gives it two seconds', async () => {
    expect(await commandExists('node')).toBe(true);
    expect(fake.seen).toEqual([{ command: 'command -v node', timeout: 2000 }]);
  });

  it('is false when the shell exits non-zero', async () => {
    fake.next = Object.assign(new Error('exit 1'), { code: 1 });
    expect(await commandExists('mdc-no-such-command')).toBe(false);
  });
});
