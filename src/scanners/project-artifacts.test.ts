import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  isCheckedByDefault,
  isInsideLinkedWorktree,
  looksLikeBuildArtifact,
  resolveSearchRoots,
} from './project-artifacts.js';

let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdc-artifacts-'));
  await fs.mkdir(path.join(root, 'main/.git'), { recursive: true });
  await fs.mkdir(path.join(root, 'main/node_modules'), { recursive: true });
  await fs.mkdir(path.join(root, 'wt/pkg/node_modules'), { recursive: true });
  await fs.writeFile(path.join(root, 'wt/.git'), 'gitdir: /elsewhere/.git/worktrees/wt\n');
  await fs.mkdir(path.join(root, 'rust/target'), { recursive: true });
  await fs.writeFile(path.join(root, 'rust/Cargo.toml'), '');
  await fs.mkdir(path.join(root, 'bare/target'), { recursive: true });
  await fs.mkdir(path.join(root, 'ios/Pods'), { recursive: true });
  await fs.writeFile(path.join(root, 'ios/Podfile'), '');
  await fs.mkdir(path.join(root, 'loose/Pods'), { recursive: true });
  await fs.mkdir(path.join(root, 'js/node_modules'), { recursive: true });
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('looksLikeBuildArtifact', () => {
  it('accepts a generic name only beside its project file', async () => {
    expect(await looksLikeBuildArtifact(path.join(root, 'rust/target'))).toBe(true);
    expect(await looksLikeBuildArtifact(path.join(root, 'ios/Pods'))).toBe(true);
  });

  it('rejects a generic name with no project file beside it', async () => {
    expect(await looksLikeBuildArtifact(path.join(root, 'bare/target'))).toBe(false);
    expect(await looksLikeBuildArtifact(path.join(root, 'loose/Pods'))).toBe(false);
  });

  it('needs nothing for an unambiguous name', async () => {
    expect(await looksLikeBuildArtifact(path.join(root, 'js/node_modules'))).toBe(true);
  });
});

describe('isCheckedByDefault', () => {
  it('leaves virtualenvs unchecked, since they may not be reproducible', () => {
    expect(isCheckedByDefault('/p/.venv')).toBe(false);
    expect(isCheckedByDefault('/p/venv')).toBe(false);
  });

  it('keeps ordinary build output checked', () => {
    expect(isCheckedByDefault('/p/node_modules')).toBe(true);
    expect(isCheckedByDefault('/p/.next')).toBe(true);
  });
});

describe('looksLikeBuildArtifact markers', () => {
  it.each(['pom.xml', 'build.sbt'])('accepts a target folder next to %s', async (marker) => {
    const dir = path.join(root, `marker-${marker}`);
    await fs.mkdir(path.join(dir, 'target'), { recursive: true });
    await fs.writeFile(path.join(dir, marker), '');
    expect(await looksLikeBuildArtifact(path.join(dir, 'target'))).toBe(true);
  });
});

describe('isInsideLinkedWorktree', () => {
  it('does not take a .git symlink for the file a linked worktree has', async () => {
    const dir = path.join(root, 'linkgit');
    await fs.mkdir(path.join(dir, 'pkg/node_modules'), { recursive: true });
    await fs.writeFile(path.join(root, 'gitfile'), 'gitdir: /elsewhere\n');
    await fs.symlink(path.join(root, 'gitfile'), path.join(dir, '.git'));
    expect(await isInsideLinkedWorktree(path.join(dir, 'pkg/node_modules'), root)).toBe(false);
  });

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

describe('resolveSearchRoots with explicit roots', () => {
  it('keeps one entry per real folder and drops what does not exist', async () => {
    const real = path.join(root, 'main');
    const link = path.join(root, 'main-link');
    await fs.symlink(real, link);

    const roots = await resolveSearchRoots([real, link, path.join(root, 'nowhere')]);

    expect(roots).toEqual([real]);
  });
});
