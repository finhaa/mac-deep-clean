import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canWriteDir } from './fs.js';

let root: string;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-canwrite-'));
});

afterEach(async () => {
  await fsp.chmod(root, 0o700);
  await fsp.rm(root, { recursive: true, force: true });
});

describe('canWriteDir', () => {
  it('says yes for a folder this process owns', async () => {
    expect(await canWriteDir(root)).toBe(true);
  });

  it('says no for a folder that is missing or a file that cannot be searched', async () => {
    const file = path.join(root, 'file');
    await fsp.writeFile(file, 'x', { mode: 0o600 });
    expect(await canWriteDir(path.join(root, 'missing'))).toBe(false);
    expect(await canWriteDir(file)).toBe(false);
  });

  it('says no for a read-only folder, which only root may still write', async () => {
    await fsp.chmod(root, 0o500);
    expect(await canWriteDir(root)).toBe(process.getuid?.() === 0);
  });
});
