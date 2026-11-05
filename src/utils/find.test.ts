import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findDirsNamed } from './find.js';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdc-find-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const fake = (stdout: string) => async () => stdout;

describe('findDirsNamed (real find)', () => {
  it('returns the directories with the requested names', async () => {
    await fs.mkdir(path.join(root, 'a/node_modules'), { recursive: true });
    await fs.mkdir(path.join(root, 'b/.venv'), { recursive: true });
    await fs.mkdir(path.join(root, 'c/src'), { recursive: true });

    const found = await findDirsNamed(root, ['node_modules', '.venv'], 5);

    expect(found.sort()).toEqual([path.join(root, 'a/node_modules'), path.join(root, 'b/.venv')]);
  });

  it('keeps a directory name that contains a newline in one piece', async () => {
    const hostile = path.join(root, 'evil\n/tmp/forged/node_modules');
    await fs.mkdir(hostile, { recursive: true });
    await fs.mkdir(path.join(root, 'real/node_modules'), { recursive: true });

    const found = await findDirsNamed(root, ['node_modules'], 8);

    expect(found.sort()).toEqual([hostile, path.join(root, 'real/node_modules')].sort());
    expect(found).not.toContain(path.join(root, 'evil'));
    expect(found).not.toContain('/tmp/forged/node_modules');
  });

  it('finds directories under a root whose own name has a quote, a dollar sign and a space', async () => {
    const odd = path.join(root, 'my "odd" $HOME dir');
    await fs.mkdir(path.join(odd, 'p/node_modules'), { recursive: true });

    expect(await findDirsNamed(odd, ['node_modules'], 5)).toEqual([
      path.join(odd, 'p/node_modules'),
    ]);
  });

  it('does not descend into a matching directory', async () => {
    await fs.mkdir(path.join(root, 'a/node_modules/dep/node_modules'), { recursive: true });

    expect(await findDirsNamed(root, ['node_modules'], 8)).toEqual([
      path.join(root, 'a/node_modules'),
    ]);
  });

  it('respects the depth limit', async () => {
    await fs.mkdir(path.join(root, 'a/b/c/d/node_modules'), { recursive: true });

    expect(await findDirsNamed(root, ['node_modules'], 3)).toEqual([]);
    expect(await findDirsNamed(root, ['node_modules'], 4)).toEqual([]);
    expect(await findDirsNamed(root, ['node_modules'], 5)).toHaveLength(1);
  });

  it('ignores a regular file that carries a requested name', async () => {
    await fs.mkdir(path.join(root, 'a'), { recursive: true });
    await fs.writeFile(path.join(root, 'a/node_modules'), 'not a folder');
    await fs.writeFile(path.join(root, 'b'), 'not a folder');

    expect(await findDirsNamed(root, ['node_modules', 'b'], 5)).toEqual([]);
  });
});

describe('findDirsNamed when find cannot enter a folder', () => {
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

  it.skipIf(isRoot)(
    'still returns what it found elsewhere, since find prints the rest and exits 1',
    async () => {
      await fs.mkdir(path.join(root, 'a/node_modules'), { recursive: true });
      const locked = path.join(root, 'locked');
      await fs.mkdir(path.join(locked, 'inner'), { recursive: true });
      await fs.chmod(locked, 0o000);
      try {
        expect(await findDirsNamed(root, ['node_modules'], 5)).toEqual([
          path.join(root, 'a/node_modules'),
        ]);
      } finally {
        await fs.chmod(locked, 0o755);
      }
    },
  );
});

describe('findDirsNamed (parsing of what find printed)', () => {
  it('drops a last record that was cut off, since it has no terminator', async () => {
    const found = await findDirsNamed(
      root,
      ['node_modules'],
      5,
      fake(`${root}/a/node_modules\0${root}/b/node_modules`),
    );

    expect(found).toEqual([`${root}/a/node_modules`]);
  });

  it('returns nothing for empty output', async () => {
    expect(await findDirsNamed(root, ['node_modules'], 5, fake(''))).toEqual([]);
  });

  it('drops a record outside the search root', async () => {
    const found = await findDirsNamed(
      root,
      ['node_modules'],
      5,
      fake(`/etc/x/node_modules\0${root}/../sibling/node_modules\0${root}/ok/node_modules\0`),
    );

    expect(found).toEqual([`${root}/ok/node_modules`]);
  });

  it('drops a record whose last segment is not one of the requested names', async () => {
    const found = await findDirsNamed(
      root,
      ['node_modules'],
      5,
      fake(`${root}/proj\0${root}/ok/node_modules\0`),
    );

    expect(found).toEqual([`${root}/ok/node_modules`]);
  });

  it('drops the search root itself and duplicates', async () => {
    const found = await findDirsNamed(
      path.join(root, 'node_modules'),
      ['node_modules'],
      5,
      fake(
        `${root}/node_modules\0${root}/node_modules/a/node_modules\0${root}/node_modules/a/node_modules\0`,
      ),
    );

    expect(found).toEqual([`${root}/node_modules/a/node_modules`]);
  });
});

describe('findDirsNamed (record filter)', () => {
  const records = (...paths: string[]) => fake(`${paths.join('\0')}\0`);

  it('matches the root ignoring case, like the rest of the tool', async () => {
    const found = await findDirsNamed(
      '/Users/me/Code',
      ['node_modules'],
      5,
      records('/users/me/code/a/node_modules'),
    );
    expect(found).toEqual(['/users/me/code/a/node_modules']);
  });

  it('never returns the root itself, whatever its spelling', async () => {
    const same = await findDirsNamed(
      '/work/node_modules',
      ['node_modules'],
      5,
      records('/work/node_modules'),
    );
    const folded = await findDirsNamed(
      '/Work/node_modules',
      ['node_modules'],
      5,
      records('/work/node_modules'),
    );
    expect(same).toEqual([]);
    expect(folded).toEqual([]);
  });

  it('drops a record that only shares a name prefix with the root', async () => {
    const found = await findDirsNamed(
      '/work/app',
      ['node_modules'],
      5,
      records('/work/app-old/node_modules', '/work/app/node_modules'),
    );
    expect(found).toEqual(['/work/app/node_modules']);
  });
});
