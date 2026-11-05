import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ home: '' }));

vi.mock('../utils/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/paths.js')>();
  const os = await import('node:os');
  const fs = await import('node:fs');
  const nodePath = await import('node:path');
  h.home = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'mdc-defaults-'));
  return { ...actual, HOME: h.home };
});

import { DiagnosticReportsScanner } from './diagnostic-reports.js';
import { GitTmpPacksScanner } from './git-tmp-packs.js';
import { LogsScanner } from './logs.js';
import { resolveSearchRoots } from './project-artifacts.js';

const MB = 1024 * 1024;
const home = (...parts: string[]) => path.join(h.home, ...parts);

async function write(rel: string, bytes: number): Promise<void> {
  const file = home(rel);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, Buffer.alloc(bytes, 1));
}

beforeEach(async () => {
  for (const name of await fsp.readdir(h.home)) {
    await fsp.rm(home(name), { recursive: true, force: true });
  }
});

afterAll(async () => {
  await fsp.rm(h.home, { recursive: true, force: true });
});

describe('the production defaults of the scanners that tests usually override', () => {
  it('LogsScanner targets the user and system log folders', () => {
    expect(new LogsScanner().targets).toEqual([
      { path: home('Library/Logs'), label: 'User logs' },
      { path: '/Library/Logs', label: 'System logs' },
    ]);
  });

  it('LogsScanner reports the user log folder without the folders other scanners own', async () => {
    await write('Library/Logs/app.log', 11 * MB);
    await write('Library/Logs/DiagnosticReports/crash.ips', 12 * MB);
    await write('Library/Logs/JetBrains/idea/idea.log', 13 * MB);
    const results = await new LogsScanner().scan();
    const user = results.find((r) => r.path === home('Library/Logs'));
    expect(user?.label).toBe('User logs');
    expect(user?.size).toBeGreaterThan(10 * MB);
    expect(user?.size).toBeLessThan(12 * MB);
  });

  it('DiagnosticReportsScanner targets the user and system report folders', () => {
    expect(new DiagnosticReportsScanner().targets).toEqual([
      { path: home('Library/Logs/DiagnosticReports'), label: 'User DiagnosticReports' },
      { path: '/Library/Logs/DiagnosticReports', label: 'System DiagnosticReports' },
    ]);
  });

  it('DiagnosticReportsScanner reports the user report folder', async () => {
    await write('Library/Logs/DiagnosticReports/crash.ips', MB);
    const results = await new DiagnosticReportsScanner().scan();
    const user = results.find((r) => r.path === home('Library/Logs/DiagnosticReports'));
    expect(user?.label).toBe('User DiagnosticReports');
  });

  it('GitTmpPacksScanner walks the default project folders when no root is set', async () => {
    const pack = home('code/proj/.git/objects/pack/tmp_pack_abc');
    await write('code/proj/.git/objects/pack/tmp_pack_abc', 11 * MB);
    const old = new Date(Date.now() - 60 * 60_000);
    await fsp.utimes(pack, old, old);
    const results = await new GitTmpPacksScanner().scan();
    expect(results.map((r) => r.path)).toEqual([pack]);
  });
});

describe('resolveSearchRoots without explicit roots', () => {
  it.each([
    'code',
    'Code',
    'Projects',
    'projects',
    'Developer',
    'dev',
    'workspace',
    'repos',
    'Repos',
    'git',
    'src',
  ])('searches ~/%s', async (name) => {
    await fsp.mkdir(home(name));
    const roots = await resolveSearchRoots(null);
    // A case-insensitive volume answers for every spelling of the folder.
    expect(roots.map((r) => r.toLowerCase())).toEqual([home(name).toLowerCase()]);
  });

  it('leaves out folders that are missing or are not folders', async () => {
    await fsp.mkdir(home('code'));
    await fsp.writeFile(home('src'), 'a file');
    expect(await resolveSearchRoots(null)).toEqual([home('code')]);
  });

  it('ignores a default name that is a symlink, since a search root is a real folder', async () => {
    await fsp.mkdir(home('code'));
    await fsp.symlink(home('code'), home('Developer'));
    expect(await resolveSearchRoots(null)).toEqual([home('code')]);
  });

  it('lists a folder once when an explicit root is a symlink to another', async () => {
    await fsp.mkdir(home('code'));
    await fsp.symlink(home('code'), home('Developer'));
    expect(await resolveSearchRoots([home('code'), home('Developer')])).toEqual([home('code')]);
    expect(await resolveSearchRoots([home('Developer'), home('code')])).toEqual([
      home('Developer'),
    ]);
  });

  it('keeps explicit roots in the order given', async () => {
    await fsp.mkdir(home('code'));
    await fsp.mkdir(home('work'));
    await fsp.symlink(home('code'), home('Developer'));
    expect(await resolveSearchRoots([home('code'), home('work'), home('Developer')])).toEqual([
      home('code'),
      home('work'),
    ]);
  });

  it('skips an explicit root that does not exist', async () => {
    await fsp.mkdir(home('code'));
    expect(await resolveSearchRoots([home('missing'), home('code')])).toEqual([home('code')]);
  });

  it('looks for its own node_modules from the folder that holds the running source', async () => {
    const { ProjectArtifactsScanner } = await import('./project-artifacts.js');
    const { ownDir } = new ProjectArtifactsScanner();
    await expect(fsp.stat(path.join(ownDir, 'project-artifacts.ts'))).resolves.toBeDefined();
  });

  it('finds nothing in a home without project folders', async () => {
    expect(await resolveSearchRoots(null)).toEqual([]);
  });
});
