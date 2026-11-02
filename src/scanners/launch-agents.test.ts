import { describe, expect, it } from 'vitest';
import { programResolves } from './launch-agents.js';

describe('programResolves', () => {
  it('resolves a bare program name against launchd PATH', async () => {
    const exists = async (p: string) => p === '/usr/bin/open';
    expect(await programResolves('open', exists)).toBe(true);
  });

  it('reports a bare name found nowhere as missing', async () => {
    expect(await programResolves('nope', async () => false)).toBe(false);
  });

  it('never looks a bare name up relative to the working directory', async () => {
    expect(await programResolves('open', async (p) => p === 'open')).toBe(false);
  });

  it('checks an absolute path as given', async () => {
    const exists = async (p: string) => p === '/opt/homebrew/bin/redis-server';
    expect(await programResolves('/opt/homebrew/bin/redis-server', exists)).toBe(true);
    expect(await programResolves('/usr/local/bin/watchman', exists)).toBe(false);
  });
});
