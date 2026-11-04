import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectArtifactsScanner, findOwnNodeModules, isExcluded } from './project-artifacts.js';

let root: string;

const big = () => Buffer.alloc(11 * 1024 * 1024, 1);

async function makeProject(name: string): Promise<string> {
  const dir = path.join(root, name);
  await fs.mkdir(path.join(dir, 'node_modules'), { recursive: true });
  await fs.writeFile(path.join(dir, 'node_modules/blob.bin'), big());
  return path.join(dir, 'node_modules');
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdc-exclude-'));
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('isExcluded', () => {
  it('matches the excluded dir itself and anything inside it', async () => {
    const keep = path.join(root, 'keep');
    await fs.mkdir(path.join(keep, 'a/node_modules'), { recursive: true });
    expect(await isExcluded(keep, [keep])).toBe(true);
    expect(await isExcluded(path.join(keep, 'a/node_modules'), [keep])).toBe(true);
  });

  it('matches a dir that contains an excluded dir, since deleting it would delete the excluded one', async () => {
    const artifact = path.join(root, 'holder/node_modules');
    const inner = path.join(artifact, 'packages/mine');
    await fs.mkdir(inner, { recursive: true });
    expect(await isExcluded(artifact, [inner])).toBe(true);
  });

  it('does not match a sibling that only shares a name prefix', async () => {
    const keep = path.join(root, 'keep');
    const sibling = path.join(root, 'keep-not');
    await fs.mkdir(sibling, { recursive: true });
    expect(await isExcluded(sibling, [keep])).toBe(false);
    expect(await isExcluded(keep, [sibling])).toBe(false);
  });

  it('ignores case, like the default macOS volume', async () => {
    const keep = path.join(root, 'Keep');
    expect(await isExcluded(path.join(root, 'keep', 'a/node_modules'), [keep])).toBe(true);
    expect(await isExcluded(path.join(root, 'KEEP'), [path.join(root, 'keep', 'inner')])).toBe(
      true,
    );
  });

  it('is false with nothing excluded', async () => {
    expect(await isExcluded(path.join(root, 'anything'), [])).toBe(false);
  });
});

describe('findOwnNodeModules', () => {
  it('returns node_modules of the nearest ancestor package named mac-deep-clean', async () => {
    const pkg = path.join(root, 'self');
    await fs.mkdir(path.join(pkg, 'dist'), { recursive: true });
    await fs.writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: 'mac-deep-clean' }));
    expect(await findOwnNodeModules(path.join(pkg, 'dist'))).toBe(path.join(pkg, 'node_modules'));
  });

  it('ignores ancestors that are some other package', async () => {
    const other = path.join(root, 'other/dist');
    await fs.mkdir(other, { recursive: true });
    await fs.writeFile(path.join(root, 'other/package.json'), JSON.stringify({ name: 'x' }));
    expect(await findOwnNodeModules(other)).toBeNull();
  });
});

describe('ProjectArtifactsScanner', () => {
  it('does not offer an artifact dir that holds an excluded dir', async () => {
    const holder = await makeProject('proj-holder');
    const inner = path.join(holder, 'packages/mine');
    await fs.mkdir(inner, { recursive: true });
    const scanner = new ProjectArtifactsScanner();
    scanner.searchRoots = [root];
    scanner.excludeRoots = [inner];
    scanner.protectedDirs = [];

    const paths = (await scanner.scan()).map((r) => r.path);

    expect(paths).not.toContain(holder);
  });

  it('skips excluded roots and the protected node_modules of the running tool', async () => {
    const kept = await makeProject('proj-keep');
    const excluded = await makeProject('proj-excluded');
    const own = await makeProject('proj-own');
    const scanner = new ProjectArtifactsScanner();
    scanner.searchRoots = [root];
    scanner.excludeRoots = [path.dirname(excluded)];
    scanner.protectedDirs = [own];

    const found = (await scanner.scan()).map((r) => r.path);

    expect(found).toContain(kept);
    expect(found).not.toContain(excluded);
    expect(found).not.toContain(own);
  });
});
