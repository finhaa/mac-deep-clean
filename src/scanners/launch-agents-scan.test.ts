import fsp from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ home: '', plists: new Map<string, string>() }));

vi.mock('../utils/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/paths.js')>();
  const os = await import('node:os');
  const fs = await import('node:fs');
  const nodePath = await import('node:path');
  h.home = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'mdc-agents-'));
  return { ...actual, HOME: h.home };
});
vi.mock('../utils/exec.js', () => ({
  run: vi.fn(async (command: string) => {
    for (const [file, json] of h.plists) {
      if (command.includes(`"${file}"`)) return { stdout: json, stderr: '', code: 0 };
    }
    return { stdout: '', stderr: '', code: 1 };
  }),
}));

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
    const b = await agent('b.plist', JSON.stringify({ ProgramArguments: ['/gone/b', '--x'] }));
    const results = await ours();
    expect(results.map((r) => r.path).sort()).toEqual([a, b].sort());
    expect(results[0]?.label).toContain('→');
    expect(results.every((r) => r.risk === 'moderate')).toBe(true);
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
