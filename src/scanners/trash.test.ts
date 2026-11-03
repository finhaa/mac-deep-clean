import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScanResult } from '../types.js';
import { TrashScanner } from './trash.js';

let root: string;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdc-trash-'));
  await fsp.writeFile(path.join(root, 'small'), Buffer.alloc(200 * 1024));
  await fsp.writeFile(path.join(root, 'locked'), Buffer.alloc(600 * 1024));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fsp.rm(root, { recursive: true, force: true });
});

function item(size: number): ScanResult {
  return {
    path: root,
    size,
    label: 'Files in Trash',
    category: 'trash',
    risk: 'safe',
  };
}

describe('TrashScanner.clean', () => {
  it('reports only the bytes that were really removed and the child that failed', async () => {
    const realRm = fsp.rm.bind(fsp);
    vi.spyOn(fsp, 'rm').mockImplementation(async (target, options) => {
      if (String(target).endsWith('locked')) throw new Error('EACCES: permission denied');
      return realRm(target, options);
    });
    const { freed, errors } = await new TrashScanner().clean([item(800 * 1024)]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('locked');
    expect(freed).toBeGreaterThan(150 * 1024);
    expect(freed).toBeLessThan(300 * 1024);
    expect(await fsp.readdir(root)).toEqual(['locked']);
  });

  it('reports the full size when everything is removed', async () => {
    const { freed, errors } = await new TrashScanner().clean([item(800 * 1024)]);
    expect(errors).toEqual([]);
    expect(freed).toBeGreaterThan(700 * 1024);
    expect(await fsp.readdir(root)).toEqual([]);
  });

  it('touches nothing on a dry run', async () => {
    const { freed, errors } = await new TrashScanner().clean([item(800 * 1024)], true);
    expect(errors).toEqual([]);
    expect(freed).toBe(800 * 1024);
    expect((await fsp.readdir(root)).sort()).toEqual(['locked', 'small']);
  });
});
