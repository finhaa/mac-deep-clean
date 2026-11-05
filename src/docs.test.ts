import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getAllScanners } from './scanners/index.js';

const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

describe('README', () => {
  it('lists every scanner category in its table', () => {
    const readme = read('README.md');
    const missing = getAllScanners()
      .map((s) => s.category)
      .filter((category) => !readme.includes(`| \`${category}\``));
    expect(missing).toEqual([]);
  });
});

describe('README --yes', () => {
  it('says what --yes does with snapshots and other irreversible categories', () => {
    const readme = read('README.md');
    expect(readme).toContain('With `--yes` only safe items are picked');
    expect(readme).not.toContain('nothing is picked for you');
  });
});

describe('clean --deep help', () => {
  it('says --yes also needs the electron category, like the README', () => {
    expect(read('src/index.ts')).toContain('--category electron');
  });
});

describe('README root advice', () => {
  it('does not say only system-cache needs a root run', () => {
    expect(read('README.md')).not.toMatch(/Only `system-cache`/);
  });
});

describe('README sudo advice', () => {
  it('does not run the whole tool as root for snapshot categories that call sudo themselves', () => {
    expect(read('README.md')).not.toMatch(
      /sudo node dist\/index\.js clean --category (time-machine|apfs-snapshots)/,
    );
  });
});

describe('CHANGELOG', () => {
  it('states the real number of scanners', () => {
    const count = getAllScanners().length;
    expect(read('CHANGELOG.md')).toContain(`Initial ${count}-scanner suite`);
  });

  it('names the CI runner the workflow really uses', () => {
    const runner = /runs-on:\s*(\S+)/.exec(read('.github/workflows/ci.yml'))?.[1];
    expect(runner).toBeDefined();
    expect(read('CHANGELOG.md')).toContain(`CI workflow on \`${runner}\``);
  });

  it('does not claim a proof by mutation that no file records', () => {
    expect(read('CHANGELOG.md')).not.toMatch(/proved by mutation/);
  });

  it('does not claim docker cleanup removes volumes', () => {
    expect(read('CHANGELOG.md')).not.toMatch(/prune -a --volumes/);
  });
});
