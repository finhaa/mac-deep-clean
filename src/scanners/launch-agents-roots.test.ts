import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const seen = vi.hoisted(() => ({ checked: [] as string[] }));

vi.mock('../utils/fs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/fs.js')>();
  return {
    ...actual,
    isDirectory: vi.fn(async (p: string) => {
      seen.checked.push(p);
      return false;
    }),
  };
});

import { HOME } from '../utils/paths.js';
import { LaunchAgentsScanner } from './launch-agents.js';

beforeEach(() => {
  seen.checked.length = 0;
});

describe('LaunchAgentsScanner roots', () => {
  it('looks in the user agents, the system agents and the system daemons, in that order', async () => {
    await new LaunchAgentsScanner().scan();

    expect(seen.checked).toEqual([
      path.join(HOME, 'Library/LaunchAgents'),
      '/Library/LaunchAgents',
      '/Library/LaunchDaemons',
    ]);
  });
});
