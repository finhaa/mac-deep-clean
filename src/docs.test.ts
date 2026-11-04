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

  it('does not claim docker cleanup removes volumes', () => {
    expect(read('CHANGELOG.md')).not.toMatch(/prune -a --volumes/);
  });
});
