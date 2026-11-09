import { existsSync } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  home: '',
  plists: new Map<string, string>(),
  presentAtBootout: [] as boolean[],
}));

vi.mock('../utils/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/paths.js')>();
  const os = await import('node:os');
  const fs = await import('node:fs');
  const nodePath = await import('node:path');
  h.home = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'mdc-agents-'));
  return { ...actual, HOME: h.home };
});
vi.mock('../utils/exec.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/exec.js')>()),
  run: vi.fn(async (command: string) => {
    if (command.startsWith('launchctl bootout')) {
      const file = /'([^']+)'$/.exec(command)?.[1];
      h.presentAtBootout.push(file !== undefined && existsSync(file));
    }
    for (const [file, json] of h.plists) {
      if (command.includes(`'${file}'`)) return { stdout: json, stderr: '', code: 0 };
    }
    return { stdout: '', stderr: '', code: 1 };
  }),
}));

import { run } from '../utils/exec.js';
import { LaunchAgentsScanner } from './launch-agents.js';

async function agent(name: string, json: string): Promise<string> {
  const dir = path.join(h.home, 'Library/LaunchAgents');
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await fsp.writeFile(file, 'plist');
  h.plists.set(file, json);
  return file;
}

beforeEach(async () => {
  h.plists.clear();
  h.presentAtBootout.length = 0;
  await fsp.rm(path.join(h.home, 'Library'), { recursive: true, force: true });
});

afterAll(async () => {
  await fsp.rm(h.home, { recursive: true, force: true });
});

const ours = async () =>
  (await new LaunchAgentsScanner().scan()).filter((r) => r.path.startsWith(h.home));

describe('LaunchAgentsScanner.scan', () => {
  it('reports an agent whose program no longer exists, from Program or ProgramArguments', async () => {
    const a = await agent('a.plist', JSON.stringify({ Program: '/gone/a' }));
    const b = await agent(
      'b.plist',
      JSON.stringify({ ProgramArguments: ['/gone/b', process.execPath] }),
    );
    const results = await ours();
    expect(results.map((r) => r.path).sort()).toEqual([a, b].sort());
    expect(results[0]?.label).toContain('→');
    expect(results.every((r) => r.risk === 'moderate')).toBe(true);
  });

  it('judges ProgramArguments by its first entry, the program, never by an argument', async () => {
    await agent(
      'runs.plist',
      JSON.stringify({ ProgramArguments: [process.execPath, '/gone/argument'] }),
    );
    expect(await ours()).toEqual([]);
  });

  it('keeps agents whose program exists or resolves on the launchd PATH', async () => {
    await agent('there.plist', JSON.stringify({ Program: process.execPath }));
    await agent('open.plist', JSON.stringify({ ProgramArguments: ['open'] }));
    expect(await ours()).toEqual([]);
  });

  it('ignores files that are not plists and plists it cannot read or that name no program', async () => {
    const dir = path.join(h.home, 'Library/LaunchAgents');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'notes.txt'), 'x');
    h.plists.set(path.join(dir, 'notes.txt'), JSON.stringify({ Program: '/gone/notes' }));
    await agent('broken.plist', '{not json');
    await agent('empty.plist', JSON.stringify({ Label: 'x' }));
    await agent('noargs.plist', JSON.stringify({ ProgramArguments: [] }));
    await fsp.writeFile(path.join(dir, 'unreadable.plist'), 'x');
    expect(await ours()).toEqual([]);
  });
});

describe('LaunchAgentsScanner.scan when the program cannot be judged', () => {
  it('keeps agents whose program is relative or sits on an unmounted volume', async () => {
    await agent('rel.plist', JSON.stringify({ Program: 'bin/tool' }));
    await agent('vol.plist', JSON.stringify({ Program: '/Volumes/DefinitelyNotMounted/tool' }));
    expect(await ours()).toEqual([]);
  });
});

describe('LaunchAgentsScanner.scan when the program cannot be read', () => {
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

  it.skipIf(isRoot)('keeps an agent whose program sits in a folder it may not enter', async () => {
    const locked = path.join(h.home, 'locked');
    await fsp.mkdir(locked, { recursive: true });
    await fsp.writeFile(path.join(locked, 'tool'), 'x');
    await agent('locked.plist', JSON.stringify({ Program: path.join(locked, 'tool') }));
    await fsp.chmod(locked, 0o000);
    try {
      expect(await ours()).toEqual([]);
    } finally {
      await fsp.chmod(locked, 0o755);
    }
  });
});

describe('LaunchAgentsScanner.scan when the program path runs through a file', () => {
  it('reports it, since nothing can exist below a regular file', async () => {
    const plain = path.join(h.home, 'plain-file');
    await fsp.writeFile(plain, 'x');
    const orphan = await agent('below-file.plist', JSON.stringify({ Program: `${plain}/tool` }));
    expect((await ours()).map((r) => r.path)).toEqual([orphan]);
  });
});

describe('LaunchAgentsScanner.clean', () => {
  const bootouts = () =>
    vi
      .mocked(run)
      .mock.calls.map((c) => String(c[0]))
      .filter((c) => c.startsWith('launchctl bootout'));

  it('unloads a user agent before removing its plist', async () => {
    vi.mocked(run).mockClear();
    const file = await agent('gone.plist', JSON.stringify({ Program: '/gone/a' }));
    const [item] = await ours();
    if (!item) throw new Error('expected an orphan');

    vi.stubEnv('SUDO_UID', undefined);
    const { freed, errors } = await new LaunchAgentsScanner().clean([item], false).finally(() => {
      vi.unstubAllEnvs();
    });

    expect(errors).toEqual([]);
    expect(freed).toBe(item.size);
    expect(bootouts()).toHaveLength(1);
    expect(bootouts()[0]).toMatch(/^launchctl bootout gui\/\d+ /);
    expect(bootouts()[0]).toContain(`'${file}'`);
    expect(h.presentAtBootout).toEqual([true]);
    await expect(fsp.stat(file)).rejects.toThrow();
  });

  it('removes a plist through the deletion guard, never a protected path', async () => {
    const protectedItem = {
      path: '/usr/local/mdc-never-here.plist',
      size: 5,
      label: 'x',
      category: 'launch-agents',
      risk: 'moderate' as const,
    };
    const { freed, errors } = await new LaunchAgentsScanner().clean([protectedItem], false);
    expect(freed).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Refusing to delete protected path');
  });

  it('does not try to unload a plist outside the user LaunchAgents folder', async () => {
    vi.mocked(run).mockClear();
    const item = {
      path: path.join(h.home, 'Library/LaunchDaemons/x.plist'),
      size: 1,
      label: 'x',
      category: 'launch-agents',
      risk: 'moderate' as const,
    };
    await new LaunchAgentsScanner().clean([item], false);
    expect(bootouts()).toEqual([]);
  });

  it('does not try to unload a plist in a folder that only starts with the LaunchAgents path', async () => {
    vi.mocked(run).mockClear();
    const item = {
      path: path.join(h.home, 'Library/LaunchAgentsOld/x.plist'),
      size: 1,
      label: 'x',
      category: 'launch-agents',
      risk: 'moderate' as const,
    };
    await new LaunchAgentsScanner().clean([item], false);
    expect(bootouts()).toEqual([]);
  });

  it('never builds a launchctl command from a non-numeric SUDO_UID', async () => {
    vi.mocked(run).mockClear();
    vi.stubEnv('SUDO_UID', '1; touch /tmp/pwned');
    try {
      await agent('gone.plist', JSON.stringify({ Program: '/gone/a' }));
      const [item] = await ours();
      if (!item) throw new Error('expected an orphan');
      await new LaunchAgentsScanner().clean([item], false);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(bootouts()).toEqual([]);
  });

  it('unloads nothing and keeps the file on a dry run', async () => {
    vi.mocked(run).mockClear();
    const file = await agent('gone.plist', JSON.stringify({ Program: '/gone/a' }));
    const [item] = await ours();
    if (!item) throw new Error('expected an orphan');

    await new LaunchAgentsScanner().clean([item], true);

    expect(bootouts()).toEqual([]);
    await expect(fsp.stat(file)).resolves.toBeDefined();
  });
});
