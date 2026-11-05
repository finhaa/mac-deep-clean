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

describe('README irreversible list', () => {
  const readme = () => read('README.md').replace(/\s+/g, ' ');

  it('names every irreversible kind of item the code flags', () => {
    for (const phrase of [
      'Time Machine and APFS snapshots',
      'iOS backups',
      'screen recording data',
      'music libraries',
      'the Docker system prune',
      'Xcode Archives',
      'Android virtual devices',
      'Electron app state (`--deep`)',
      'JetBrains caches',
    ]) {
      expect(readme(), phrase).toContain(phrase);
    }
  });

  it('says --yes --risky leaves the irreversible items out and that their category picks them', () => {
    expect(readme()).toContain('adds the moderate and risky ones except the irreversible items');
    expect(readme()).toContain('They run only when you name their category');
    expect(readme()).not.toMatch(/adds every item/i);
  });
});

describe('clean help for --yes', () => {
  it('says irreversible items need their own category and that --risky or --category widen the pick', () => {
    const source = read('src/index.ts');
    expect(source).toContain(
      'Skip prompts; selects only safe items unless --risky or --category is set',
    );
    expect(source).toContain('irreversible items need their own --category');
  });
});

describe('clean --deep help', () => {
  it('says --yes also needs the electron category, like the README', () => {
    expect(read('src/index.ts')).toContain('--category electron');
  });
});

describe('package.json scripts', () => {
  it('formats the same files it lints', () => {
    const { scripts } = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const targets = (script: string | undefined, prefix: string) =>
      (script ?? '').replace(prefix, '').trim().split(/\s+/).sort();
    expect(targets(scripts.format, 'biome format --write')).toEqual(
      targets(scripts.lint, 'biome check'),
    );
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
