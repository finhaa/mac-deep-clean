import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectArtifactsScanner } from './project-artifacts.js';

let root: string;

const big = () => Buffer.alloc(11 * 1024 * 1024, 1);

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdc-scan-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function artifact(dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'blob.bin'), big());
  return dir;
}

function scanner(searchRoot: string): ProjectArtifactsScanner {
  const s = new ProjectArtifactsScanner();
  s.searchRoots = [searchRoot];
  s.protectedDirs = [];
  return s;
}

describe('ProjectArtifactsScanner.scan with hostile directory names', () => {
  it('never offers a sibling project or an outside path forged by a newline in a name', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mdc-outside-'));
    try {
      const outsideArtifact = await artifact(path.join(outside, 'node_modules'));
      await fs.mkdir(path.join(root, 'sibling-project/src'), { recursive: true });
      // The search root itself carries the forged line, so the walk depth does not depend on how deep the OS temp dir is.
      const hostileRoot = path.join(root, `evil\n${outside}`);
      const hostile = await artifact(path.join(hostileRoot, 'node_modules'));

      const paths = (await scanner(hostileRoot).scan()).map((r) => r.path);

      expect(paths).toContain(hostile);
      expect(paths).not.toContain(path.join(root, 'evil'));
      expect(paths).not.toContain(outsideArtifact);
      expect(paths).not.toContain(path.join(root, 'sibling-project'));
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('scans a search root whose name has quotes, a dollar sign and spaces', async () => {
    const odd = path.join(root, 'my "odd" $HOME `dir`');
    const found = await artifact(path.join(odd, 'p/node_modules'));

    const paths = (await scanner(odd).scan()).map((r) => r.path);

    expect(paths).toEqual([found]);
  });
});

describe('ProjectArtifactsScanner.scan default self-protect', () => {
  it('never offers the node_modules of the tool it is running from', async () => {
    const repoRoot = path.resolve(import.meta.dirname, '../..');
    const own = path.join(repoRoot, 'node_modules');
    const s = new ProjectArtifactsScanner();
    s.searchRoots = [repoRoot];

    const paths = (await s.scan()).map((r) => r.path);

    expect(paths).not.toContain(own);
  });
});

describe('ProjectArtifactsScanner.scan default self-protect wiring', () => {
  it("protects the running tool's node_modules when no protectedDirs are injected", async () => {
    const pkg = path.join(root, 'tool');
    await fs.mkdir(path.join(pkg, 'dist'), { recursive: true });
    await fs.writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: 'mac-deep-clean' }));
    const own = await artifact(path.join(pkg, 'node_modules'));
    const other = await artifact(path.join(root, 'other/node_modules'));
    const s = new ProjectArtifactsScanner();
    s.searchRoots = [root];
    s.ownDir = path.join(pkg, 'dist');

    const paths = (await s.scan()).map((r) => r.path);

    expect(paths).toContain(other);
    expect(paths).not.toContain(own);
  });
});

describe('ProjectArtifactsScanner.scan filters', () => {
  it('skips artifacts inside a linked git worktree but keeps the main checkout', async () => {
    const main = await artifact(path.join(root, 'main/node_modules'));
    await fs.mkdir(path.join(root, 'main/.git'), { recursive: true });
    await artifact(path.join(root, 'linked/node_modules'));
    await fs.writeFile(path.join(root, 'linked/.git'), 'gitdir: ../main/.git/worktrees/linked');

    const paths = (await scanner(root).scan()).map((r) => r.path);

    expect(paths).toEqual([main]);
  });

  it('offers target and Pods only next to their project file', async () => {
    const rust = await artifact(path.join(root, 'rust/target'));
    await fs.writeFile(path.join(root, 'rust/Cargo.toml'), '[package]');
    await artifact(path.join(root, 'plain/target'));
    const pods = await artifact(path.join(root, 'ios/Pods'));
    await fs.writeFile(path.join(root, 'ios/Podfile'), '');
    await artifact(path.join(root, 'stray/Pods'));

    const paths = (await scanner(root).scan()).map((r) => r.path).sort();

    expect(paths).toEqual([pods, rust].sort());
  });

  it('skips artifacts smaller than 10 MB', async () => {
    await fs.mkdir(path.join(root, 'small/node_modules'), { recursive: true });
    await fs.writeFile(path.join(root, 'small/node_modules/f'), 'tiny');
    expect(await scanner(root).scan()).toEqual([]);
  });
});
