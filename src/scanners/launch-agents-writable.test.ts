import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ writable: new Set<string>() }));

const DAEMONS = '/Library/LaunchDaemons';
const AGENTS = '/Library/LaunchAgents';

vi.mock('../utils/fs.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/fs.js')>()),
  isDirectory: vi.fn(async (p: string) => p === DAEMONS || p === AGENTS),
  listDir: vi.fn(async (p: string) => [`${path.basename(p)}.redis.plist`]),
  canWriteDir: vi.fn(async (p: string) => h.writable.has(p)),
}));
vi.mock('../utils/exec.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/exec.js')>()),
  run: vi.fn(async () => ({
    stdout: JSON.stringify({ Program: '/nonexistent-mdc/opt/redis/bin/redis-server' }),
    stderr: '',
    code: 0,
  })),
}));

import { LaunchAgentsScanner } from './launch-agents.js';

beforeEach(() => {
  h.writable.clear();
});

const offered = async () => (await new LaunchAgentsScanner().scan()).map((r) => r.path);

describe('LaunchAgentsScanner and folders it cannot write', () => {
  it('does not offer an orphan in a system folder this process cannot write, as a run without sudo', async () => {
    expect(await offered()).toEqual([]);
  });

  it('offers it when the folder is writable, as under sudo', async () => {
    h.writable.add(DAEMONS);
    expect(await offered()).toEqual([path.join(DAEMONS, 'LaunchDaemons.redis.plist')]);
    h.writable.add(AGENTS);
    expect(await offered()).toEqual([
      path.join(AGENTS, 'LaunchAgents.redis.plist'),
      path.join(DAEMONS, 'LaunchDaemons.redis.plist'),
    ]);
  });
});
