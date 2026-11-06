import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => ({ problem: null as string | null }));

vi.mock('../scanners/project-artifacts.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../scanners/project-artifacts.js')>()),
  checkPurgeRoot: vi.fn(async (root: string) => ({ real: root, problem: probe.problem })),
}));

import { ProjectArtifactsScanner } from '../scanners/project-artifacts.js';
import { purgeCommand } from './purge.js';

let root: string;

const errors = () =>
  vi
    .mocked(console.error)
    .mock.calls.map((c) => c.join(' '))
    .join('\n');

beforeEach(async () => {
  process.exitCode = undefined;
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-purge-sanitise-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  await fsp.rm(root, { recursive: true, force: true });
});

describe('purge --path terminal output', () => {
  it('prints a refusal reason that carries an escape sequence as plain text', async () => {
    probe.problem = '/opt/evil\u001b[2K\rname is inside /opt';
    const scan = vi.spyOn(ProjectArtifactsScanner.prototype, 'scan');

    await purgeCommand({ path: [root], yes: true, dryRun: true });

    expect(process.exitCode).toBe(1);
    expect(scan).not.toHaveBeenCalled();
    expect(errors()).toContain('evil?[2K?name');
    expect(errors()).not.toContain('\u001b');
    expect(errors()).not.toContain('\r');
  });

  it('prints a path that is not a directory without its escape sequences', async () => {
    await purgeCommand({ path: ['/definitely/not/a/dir\u001b[2K\rx'], yes: true, dryRun: true });

    expect(process.exitCode).toBe(1);
    expect(errors()).toContain('Not a directory');
    expect(errors()).toContain('dir?[2K?x');
    expect(errors()).not.toContain('\u001b');
  });
});
