import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ownerUid } from './fs.js';

let root: string;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-owner-'));
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

describe('ownerUid', () => {
  it('gives the uid of a folder this process created', async () => {
    expect(await ownerUid(root)).toBe(process.getuid?.());
  });

  it('gives nothing for a missing path', async () => {
    expect(await ownerUid(path.join(root, 'missing'))).toBeUndefined();
  });

  it('gives the owner of a symlink, not of the root-owned folder it points to', async () => {
    const link = path.join(root, 'link');
    await fsp.symlink('/', link);
    expect((await fsp.stat(link)).uid).toBe(0);
    expect(await ownerUid(link)).toBe(process.getuid?.());
  });
});
