import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canJudgeProgram,
  mountPointOf,
  programResolves,
  volumeReachable,
} from './launch-agents.js';

describe('programResolves', () => {
  it('resolves a bare program name against launchd PATH', async () => {
    const exists = async (p: string) => p === '/usr/bin/open';
    expect(await programResolves('open', exists)).toBe(true);
  });

  it('reports a bare name found nowhere as missing', async () => {
    expect(await programResolves('nope', async () => false)).toBe(false);
  });

  it('looks a bare name up in the four launchd directories, in order', async () => {
    const seen: string[] = [];
    await programResolves('tool', async (p) => {
      seen.push(p);
      return false;
    });
    expect(seen).toEqual(['/usr/bin/tool', '/bin/tool', '/usr/sbin/tool', '/sbin/tool']);
    expect(await programResolves('tool', async (p) => p === '/usr/sbin/tool')).toBe(true);
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

  it('reads the volume from the path as the kernel resolves it, not as it is spelled', async () => {
    const mounted = async (p: string) => p === '/Volumes/Work';
    expect(await canJudgeProgram('/Volumes/Work/../Gone/bin/x', mounted)).toBe(false);
    expect(await canJudgeProgram('//Volumes/Gone/bin/x', mounted)).toBe(false);
    expect(await canJudgeProgram('/volumes/Gone/bin/x', mounted)).toBe(false);
    expect(await canJudgeProgram('/System/Volumes/Data/Volumes/Gone/bin/x', mounted)).toBe(false);
    expect(await canJudgeProgram('/Volumes/Work/./bin/x', mounted)).toBe(true);
  });
});

describe('canJudgeProgram through symlinks', () => {
  it('judges a program on a volume that is gone by its default reachability check', async () => {
    expect(await canJudgeProgram('/Volumes/mdc-gone-disk/bin/x')).toBe(false);
  });

  it('cannot judge a program behind a symlink an unmounted disk left dangling', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdc-judge-'));
    try {
      await fs.symlink('/Volumes/mdc-gone-disk', path.join(dir, 'Dangling'));
      expect(await canJudgeProgram(path.join(dir, 'Dangling', 'bin', 'x'), async () => true)).toBe(
        false,
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.getuid?.() === 0)(
    'cannot judge a program inside a folder it may not enter',
    async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdc-judge-'));
      const locked = path.join(dir, 'Locked');
      try {
        await fs.mkdir(locked);
        await fs.chmod(locked, 0o000);
        expect(await canJudgeProgram(path.join(locked, 'bin', 'x'), async () => true)).toBe(false);
      } finally {
        await fs.chmod(locked, 0o755);
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
  );

  it('judges a program path that runs through a regular file, which does not exist', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdc-judge-'));
    try {
      await fs.writeFile(path.join(dir, 'file'), 'x');
      expect(await canJudgeProgram(path.join(dir, 'file', 'bin', 'x'), async () => false)).toBe(
        true,
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('judges a missing program under a real folder and under a live symlink', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdc-judge-'));
    try {
      await fs.mkdir(path.join(dir, 'Real'));
      await fs.symlink(path.join(dir, 'Real'), path.join(dir, 'Alias'));
      expect(await canJudgeProgram(path.join(dir, 'Real', 'bin', 'x'), async () => false)).toBe(
        true,
      );
      expect(await canJudgeProgram(path.join(dir, 'Alias', 'bin', 'x'), async () => false)).toBe(
        true,
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(process.platform !== 'darwin')(
  'canJudgeProgram through a symlink to a mount point',
  () => {
    it('reads the volume behind a symlink to /Volumes or to the data volume firmlink', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdc-judge-'));
      try {
        await fs.symlink('/Volumes', path.join(dir, 'vlink'));
        await fs.symlink('/System/Volumes/Data/Volumes', path.join(dir, 'dlink'));
        const mounted = async (p: string) =>
          /^(?:\/System\/Volumes\/Data)?\/Volumes\/mdc-work$/.test(p);
        for (const link of ['vlink', 'dlink']) {
          expect(await canJudgeProgram(path.join(dir, link, 'mdc-gone', 'bin', 'x'), mounted)).toBe(
            false,
          );
          expect(await canJudgeProgram(path.join(dir, link, 'mdc-work', 'bin', 'x'), mounted)).toBe(
            true,
          );
        }
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it('reads the volume of a long s spelling of /Volumes, which the kernel resolves', async () => {
      expect(await canJudgeProgram('/Volumeſ/mdc-gone/bin/x', async () => false)).toBe(false);
    });
  },
);

describe('mountPointOf', () => {
  it('folds case by Unicode rules, so a long s spells /Volumes too', () => {
    expect(mountPointOf('/Volumeſ/Gone/bin/x')).toBe('/Volumeſ/Gone');
    expect(mountPointOf('/System/Volumes/Data/Volumeſ/Gone/x')).toBe(
      '/System/Volumes/Data/Volumeſ/Gone',
    );
    expect(mountPointOf('/opt/Volumes/Gone/x')).toBeUndefined();
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

describe('canJudgeProgram with a Volumes folder that is not at the root', () => {
  it('judges a program under /opt/Volumes, which is no mount point', async () => {
    expect(await canJudgeProgram('/opt/Volumes/Gone/bin/x', async () => false)).toBe(true);
  });
});
