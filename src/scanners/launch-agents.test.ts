import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canJudgeProgram, programResolves, volumeReachable } from './launch-agents.js';

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

describe('canJudgeProgram', () => {
  it('judges an absolute path and a bare name', async () => {
    expect(await canJudgeProgram('/opt/x/bin/y', async () => false)).toBe(true);
    expect(await canJudgeProgram('open', async () => false)).toBe(true);
  });

  it('cannot judge a relative path, which launchd resolves against its own working directory', async () => {
    expect(await canJudgeProgram('./bin/x', async () => true)).toBe(false);
    expect(await canJudgeProgram('bin/x', async () => true)).toBe(false);
  });

  it('cannot judge a program on a volume that is not mounted', async () => {
    const mounted = async (p: string) => p === '/Volumes/Work';
    expect(await canJudgeProgram('/Volumes/Work/bin/x', mounted)).toBe(true);
    expect(await canJudgeProgram('/Volumes/Gone/bin/x', mounted)).toBe(false);
  });
});

describe('volumeReachable', () => {
  it('follows a symlink, so one left behind by an unmounted disk is not reachable', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdc-volume-'));
    try {
      await fs.mkdir(path.join(dir, 'Work'));
      await fs.symlink(path.join(dir, 'Work'), path.join(dir, 'Alias'));
      await fs.symlink(path.join(dir, 'Gone'), path.join(dir, 'Dangling'));
      expect(await volumeReachable(path.join(dir, 'Work'))).toBe(true);
      expect(await volumeReachable(path.join(dir, 'Alias'))).toBe(true);
      expect(await volumeReachable(path.join(dir, 'Dangling'))).toBe(false);
      expect(await volumeReachable(path.join(dir, 'Missing'))).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
