import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitTmpPacksScanner } from './git-tmp-packs.js';
import { getAllScanners } from './index.js';

const MINUTE_MS = 60_000;
const big = () => Buffer.alloc(11 * 1024 * 1024, 1);

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdc-tmppack-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function writeAged(file: string, ageMinutes: number, data = big()): Promise<string> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
  const when = new Date(Date.now() - ageMinutes * MINUTE_MS);
  await fs.utimes(file, when, when);
  return file;
}

function packFile(repo: string, name: string): string {
  return path.join(root, repo, '.git/objects/pack', name);
}

function scanner(): GitTmpPacksScanner {
  const s = new GitTmpPacksScanner();
  s.searchRoots = [root];
  return s;
}

describe('GitTmpPacksScanner.scan', () => {
  it('reports a stale tmp_pack file inside .git/objects/pack', async () => {
    const stale = await writeAged(packFile('repo', 'tmp_pack_aB3xYz'), 30);

    const results = await scanner().scan();

    expect(results.map((r) => r.path)).toEqual([stale]);
    expect(results[0]?.size).toBeGreaterThanOrEqual(11 * 1024 * 1024);
    expect(results[0]?.risk).toBe('moderate');
    expect(results[0]?.category).toBe('git-tmp-packs');
  });

  it('labels a file outside HOME by its full path, not as a ~/.. climb', async () => {
    const stale = await writeAged(packFile('repo', 'tmp_pack_label'), 30);

    const results = await scanner().scan();

    expect(results[0]?.label).toBe(stale);
  });

  it('skips a tmp_pack file touched within the last 10 minutes (a fetch may still be writing it)', async () => {
    await writeAged(packFile('repo', 'tmp_pack_live'), 2);

    expect(await scanner().scan()).toEqual([]);
  });

  it('skips finished packs and any file that is not named tmp_pack_*', async () => {
    await writeAged(packFile('repo', 'pack-0123abcd.pack'), 600);
    await writeAged(packFile('repo', 'pack-0123abcd.idx'), 600);

    expect(await scanner().scan()).toEqual([]);
  });

  it('skips a tmp_pack file that is not in a .git/objects/pack directory', async () => {
    await writeAged(path.join(root, 'repo/src/tmp_pack_notgit'), 600);
    await writeAged(path.join(root, 'repo/.git/tmp_pack_wrongdir'), 600);

    expect(await scanner().scan()).toEqual([]);
  });

  it('skips tmp_pack files under 10 MB', async () => {
    await writeAged(packFile('repo', 'tmp_pack_tiny'), 600, Buffer.alloc(1024));

    expect(await scanner().scan()).toEqual([]);
  });

  it('draws the size line at exactly 10 MB', async () => {
    const MB = 1024 * 1024;
    await writeAged(packFile('repo', 'tmp_pack_edge'), 600, Buffer.alloc(10 * MB, 1));
    await writeAged(packFile('repo', 'tmp_pack_short'), 600, Buffer.alloc(10 * MB - 1, 1));

    const results = await scanner().scan();

    expect(results.map((r) => path.basename(r.path))).toEqual(['tmp_pack_edge']);
  });

  it('draws the age line at 10 minutes', async () => {
    await writeAged(packFile('repo', 'tmp_pack_nine'), 9);
    const justPast = await writeAged(packFile('repo', 'tmp_pack_past'), 10.5);

    const results = await scanner().scan();

    expect(results.map((r) => r.path)).toEqual([justPast]);
  });

  it('only takes names that start with tmp_pack_', async () => {
    await writeAged(packFile('repo', 'tmp_other'), 600);
    await writeAged(packFile('repo', 'tmp_packed'), 600);

    expect(await scanner().scan()).toEqual([]);
  });

  it('walks five levels below the search root and no deeper', async () => {
    const shallow = await writeAged(path.join(root, 'a/b/c/repo/.git/objects/pack/tmp_pack_5'), 60);
    await writeAged(path.join(root, 'a/b/c/d/repo/.git/objects/pack/tmp_pack_6'), 60);

    const results = await scanner().scan();

    expect(results.map((r) => r.path)).toEqual([shallow]);
  });

  it('does not look for repositories inside node_modules', async () => {
    await writeAged(path.join(root, 'app/node_modules/dep/.git/objects/pack/tmp_pack_dep'), 60);

    expect(await scanner().scan()).toEqual([]);
  });

  it('copes with a linked worktree, whose .git is a file, and with repos that have no pack dir', async () => {
    await fs.mkdir(path.join(root, 'wt'), { recursive: true });
    await fs.writeFile(path.join(root, 'wt/.git'), 'gitdir: /elsewhere\n');
    await fs.mkdir(path.join(root, 'fresh/.git'), { recursive: true });

    expect(await scanner().scan()).toEqual([]);
  });

  it('finds a leak in a repo whose parent directory name contains a newline', async () => {
    const stale = await writeAged(packFile('team\nrepo', 'tmp_pack_nl'), 30);

    const results = await scanner().scan();

    expect(results.map((r) => r.path)).toEqual([stale]);
  });

  it('finds the leak in several repos and orders the largest first', async () => {
    await writeAged(packFile('a', 'tmp_pack_one'), 60, Buffer.alloc(11 * 1024 * 1024, 1));
    await writeAged(packFile('b', 'tmp_pack_two'), 60, Buffer.alloc(13 * 1024 * 1024, 1));

    const results = await scanner().scan();

    expect(results.map((r) => path.basename(r.path))).toEqual(['tmp_pack_two', 'tmp_pack_one']);
  });
});

describe('GitTmpPacksScanner with a symlinked pack directory', () => {
  async function linkedPackDir(): Promise<{ outside: string; viaLink: string }> {
    const outside = await writeAged(path.join(root, 'elsewhere/tmp_pack_out'), 60);
    await fs.mkdir(path.join(root, 'repo/.git/objects'), { recursive: true });
    await fs.symlink(path.join(root, 'elsewhere'), path.join(root, 'repo/.git/objects/pack'));
    return { outside, viaLink: packFile('repo', 'tmp_pack_out') };
  }

  it('does not report a file that really lives outside the repository', async () => {
    await linkedPackDir();

    expect(await scanner().scan()).toEqual([]);
  });

  it('refuses to delete through the link and leaves the real file alone', async () => {
    const { outside, viaLink } = await linkedPackDir();
    const size = (await fs.stat(outside)).size;

    const { freed, errors } = await scanner().clean(
      [{ path: viaLink, size, label: 'x', category: 'git-tmp-packs', risk: 'moderate' }],
      false,
    );

    expect(freed).toBe(0);
    expect(errors).toHaveLength(1);
    await expect(fs.stat(outside)).resolves.toBeDefined();
  });
});

describe('GitTmpPacksScanner.clean', () => {
  it('deletes only the selected stale file and reports its bytes', async () => {
    const stale = await writeAged(packFile('repo', 'tmp_pack_old'), 60);
    const finished = await writeAged(packFile('repo', 'pack-keep.pack'), 600);
    const s = scanner();
    const results = await s.scan();

    const { freed, errors } = await s.clean(results, false);

    expect(errors).toEqual([]);
    expect(freed).toBe(results[0]?.size);
    await expect(fs.stat(stale)).rejects.toThrow();
    await expect(fs.stat(finished)).resolves.toBeDefined();
  });

  it('touches nothing on a dry run', async () => {
    const stale = await writeAged(packFile('repo', 'tmp_pack_old'), 60);
    const s = scanner();
    const results = await s.scan();

    const { freed } = await s.clean(results, true);

    expect(freed).toBe(results[0]?.size);
    await expect(fs.stat(stale)).resolves.toBeDefined();
  });

  it('keeps a file that became active again between the scan and the clean', async () => {
    const stale = await writeAged(packFile('repo', 'tmp_pack_revived'), 60);
    const s = scanner();
    const results = await s.scan();
    const now = new Date();
    await fs.utimes(stale, now, now);

    const { freed, errors } = await s.clean(results, false);

    expect(freed).toBe(0);
    expect(errors).toEqual([]);
    await expect(fs.stat(stale)).resolves.toBeDefined();
  });

  it('refuses any path that is not a tmp_pack file in a .git/objects/pack directory', async () => {
    const innocent = await writeAged(path.join(root, 'repo/src/index.ts'), 600, Buffer.alloc(10));
    const item = {
      path: innocent,
      size: 10,
      label: 'x',
      category: 'git-tmp-packs',
      risk: 'moderate' as const,
    };

    const { freed, errors } = await scanner().clean([item], false);

    expect(freed).toBe(0);
    expect(errors).toHaveLength(1);
    await expect(fs.stat(innocent)).resolves.toBeDefined();
  });
});

describe('GitTmpPacksScanner.clean refuses what is not a git pack folder', () => {
  const item = (file: string) => ({
    path: file,
    size: 5,
    label: 'x',
    category: 'git-tmp-packs',
    risk: 'moderate' as const,
  });

  it('keeps a tmp_pack file in a .git subfolder other than objects/pack', async () => {
    const hook = await writeAged(path.join(root, 'repo/.git/hooks/sub/tmp_pack_x'), 60);

    const { freed, errors } = await scanner().clean([item(hook)], false);

    expect(freed).toBe(0);
    expect(errors).toHaveLength(1);
    await expect(fs.stat(hook)).resolves.toBeDefined();
  });

  it('keeps a file in objects/pack whose name only starts with tmp_', async () => {
    const other = await writeAged(packFile('repo', 'tmp_other'), 60);

    const { freed, errors } = await scanner().clean([item(other)], false);

    expect(freed).toBe(0);
    expect(errors).toHaveLength(1);
    await expect(fs.stat(other)).resolves.toBeDefined();
  });

  it('keeps a tmp_pack file at the age line when the clean runs', async () => {
    const nine = await writeAged(packFile('repo', 'tmp_pack_nine'), 9);

    const { freed } = await scanner().clean([item(nine)], false);

    expect(freed).toBe(0);
    await expect(fs.stat(nine)).resolves.toBeDefined();
  });

  it('keeps a tmp_pack file in objects/pack of a folder that is not named .git', async () => {
    const lookalike = await writeAged(path.join(root, 'repo/notgit/objects/pack/tmp_pack_x'), 60);

    const { freed, errors } = await scanner().clean([item(lookalike)], false);

    expect(freed).toBe(0);
    expect(errors).toHaveLength(1);
    await expect(fs.stat(lookalike)).resolves.toBeDefined();
  });

  it('keeps a file reached through a link that does not look like a pack folder', async () => {
    const real = await writeAged(packFile('repo', 'tmp_pack_linked'), 60);
    const link = path.join(root, 'link');
    await fs.symlink(path.dirname(real), link);

    const { freed, errors } = await scanner().clean(
      [item(path.join(link, 'tmp_pack_linked'))],
      false,
    );

    expect(freed).toBe(0);
    expect(errors).toHaveLength(1);
    await expect(fs.stat(real)).resolves.toBeDefined();
  });

  it('leaves a folder named like a tmp_pack file alone without reporting an error', async () => {
    const folder = packFile('repo', 'tmp_pack_folder');
    await fs.mkdir(folder, { recursive: true });
    const old = new Date(Date.now() - 60 * MINUTE_MS);
    await fs.utimes(folder, old, old);

    const { freed, errors } = await scanner().clean([item(folder)], false);

    expect(freed).toBe(0);
    expect(errors).toEqual([]);
    await expect(fs.stat(folder)).resolves.toBeDefined();
  });
});

describe('GitTmpPacksScanner.clean safety guard', () => {
  it('refuses a tmp_pack path inside a protected folder even though the name matches', async () => {
    const protectedPack = path.join(os.homedir(), '.ssh/repo/.git/objects/pack/tmp_pack_abc123');
    const { freed, errors } = await new GitTmpPacksScanner().clean([
      {
        path: protectedPack,
        size: big().length,
        label: 'x',
        category: 'git-tmp-packs',
        risk: 'moderate',
      },
    ]);
    expect(freed).toBe(0);
    expect(errors[0]).toContain('Refusing to delete');
  });
});

describe('registration', () => {
  it('is part of getAllScanners with the git-tmp-packs category', () => {
    expect(getAllScanners().some((s) => s.category === 'git-tmp-packs')).toBe(true);
  });
});
