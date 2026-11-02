import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isInsideLinkedWorktree } from './project-artifacts.js';

let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdc-artifacts-'));
  await fs.mkdir(path.join(root, 'main/.git'), { recursive: true });
  await fs.mkdir(path.join(root, 'main/node_modules'), { recursive: true });
  await fs.mkdir(path.join(root, 'wt/pkg/node_modules'), { recursive: true });
  await fs.writeFile(path.join(root, 'wt/.git'), 'gitdir: /elsewhere/.git/worktrees/wt\n');
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('isInsideLinkedWorktree', () => {
  it('is false for a normal checkout', async () => {
    expect(await isInsideLinkedWorktree(path.join(root, 'main/node_modules'), root)).toBe(false);
  });

  it('is true for an artifact inside a linked worktree, at any depth', async () => {
    expect(await isInsideLinkedWorktree(path.join(root, 'wt/pkg/node_modules'), root)).toBe(true);
  });

  it('does not treat an explicitly chosen search root as a worktree to skip', async () => {
    const wt = path.join(root, 'wt');
    expect(await isInsideLinkedWorktree(path.join(wt, 'pkg/node_modules'), wt)).toBe(false);
  });
});
