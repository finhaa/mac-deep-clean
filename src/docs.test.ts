import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { getAllScanners } from './scanners/index.js';
import { stripControl } from './utils/format.js';

const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

function parse(name: string): ts.SourceFile {
  return ts.createSourceFile(name, read(name), ts.ScriptTarget.Latest);
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

const isNamed = (name: ts.Node, text: string) => ts.isIdentifier(name) && name.text === text;

// Read from the scanner sources, so a flag added or removed anywhere changes the expected list.
function irreversibleCategories(): string[] {
  const found: string[] = [];
  for (const file of readdirSync(new URL('./scanners/', import.meta.url))) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    let category: string | undefined;
    let flags = false;
    walk(parse(`src/scanners/${file}`), (node) => {
      if (
        ts.isPropertyDeclaration(node) &&
        isNamed(node.name, 'category') &&
        node.initializer &&
        ts.isStringLiteral(node.initializer)
      )
        category = node.initializer.text;
      if (
        ts.isPropertyAssignment(node) &&
        isNamed(node.name, 'irreversible') &&
        node.initializer.kind !== ts.SyntaxKind.FalseKeyword
      )
        flags = true;
    });
    if (flags && category) found.push(category);
  }
  return found.sort();
}

const section = (text: string, heading: string) => {
  const start = text.indexOf(heading);
  const end = text.indexOf('\n## ', start + heading.length);
  return start < 0 ? '' : text.slice(start, end < 0 ? undefined : end);
};
const PICKS = '## What `clean` picks';
const LIST_LEAD = 'which then picks every item of it:';

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

  it('reads a real list from the scanner sources', () => {
    const categories = getAllScanners().map((s) => s.category);
    expect(irreversibleCategories().length).toBeGreaterThan(0);
    expect(irreversibleCategories().filter((c) => !categories.includes(c))).toEqual([]);
  });

  it('lists exactly the categories whose scanner flags an item irreversible', () => {
    const picks = section(read('README.md'), PICKS);
    const start = picks.indexOf(LIST_LEAD);
    expect(start).toBeGreaterThanOrEqual(0);
    const list =
      picks
        .slice(start + LIST_LEAD.length)
        .trimStart()
        .split('\n\n')[0] ?? '';
    const listed = list
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => /^- `([a-z-]+)`/.exec(line)?.[1])
      .sort();
    expect(listed).toEqual(irreversibleCategories());
  });

  it('points to that list wherever else it speaks of irreversible items', () => {
    const readme = read('README.md');
    const outside = readme.replace(section(readme, PICKS), '');
    const stray = outside
      .split('\n')
      .filter((line) => /irreversible/i.test(line) && !line.includes('(#what-clean-picks)'));
    expect(stray).toEqual([]);
  });

  it('says --yes --risky leaves the irreversible items out and that their category picks them', () => {
    expect(readme()).toContain('adds the moderate and risky ones except the irreversible items');
    expect(readme()).toContain('They run only when you name their category');
    expect(readme()).not.toMatch(/adds every item/i);
  });
});

describe('Electron state gate wording', () => {
  it('names Electron state only beside --deep in the README usage lines', () => {
    const lines = read('README.md')
      .split('\n')
      .filter((line) => line.startsWith('mac-deep-clean ') && /Electron/.test(line));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.filter((line) => !line.includes('--deep'))).toEqual([]);
  });

  it('names Electron state only beside --deep in every command line option', () => {
    const options: Array<{ flags: string; help: string }> = [];
    walk(parse('src/index.ts'), (node) => {
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
      if (node.expression.name.text !== 'option') return;
      const [flags, help] = node.arguments;
      if (flags && help && ts.isStringLiteral(flags) && ts.isStringLiteral(help))
        options.push({ flags: flags.text, help: help.text });
    });
    expect(options.length).toBeGreaterThan(0);
    const stray = options.filter(
      (o) => /Electron/.test(o.help) && !`${o.flags} ${o.help}`.includes('--deep'),
    );
    expect(stray).toEqual([]);
  });

  it('says in the README how clean lists and picks the --deep state', () => {
    const flat = read('README.md').replace(/\s+/g, ' ');
    expect(flat).toContain('`clean` lists them only with `--risky` or `--category electron`');
    expect(flat).toContain('`--yes` picks them only with `--category electron`');
  });
});

describe('CHANGELOG sanitiser entry', () => {
  const entry = () => {
    const flat = read('CHANGELOG.md').replace(/\s+/g, ' ');
    const start = flat.indexOf('- Control, format and invisible characters');
    return flat.slice(start, flat.indexOf(' - ', start + 1));
  };

  it('does not promise that a name cannot read as another one', () => {
    expect(entry()).not.toMatch(/cannot read as another/);
    expect(entry()).toContain('two names can still look alike');
  });

  it('names characters that stripControl really keeps', () => {
    const named = [...entry().matchAll(/U\+([0-9A-F]{4,6})/g)].map((m) =>
      String.fromCodePoint(Number.parseInt(m[1] ?? '', 16)),
    );
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((ch) => stripControl(ch) !== ch)).toEqual([]);
  });
});

describe('CHANGELOG entries of the round 6 fixes', () => {
  const flat = () => read('CHANGELOG.md').replace(/\s+/g, ' ');

  it.each([
    ['#85 volume spelling', 'read the volume from the program path as the kernel resolves it'],
    ['#87 Unicode case fold', 'folds case by Unicode rules'],
    ['#88 tmp pack labels', '`git-tmp-packs` labels use the same `~` shortening'],
    ['#89 sudo home', 'the home folder of the user who ran sudo'],
    ['#90 byte arrays', 'Buffers and any other byte array'],
  ])('has an entry for %s', (_pr, phrase) => {
    expect(flat()).toContain(phrase);
  });
});

describe('clean help for --yes', () => {
  it('says irreversible items need their own category and that --risky or --category widen the pick', () => {
    const source = read('src/index.ts');
    expect(source).toContain(
      'Skip prompts; selects only safe items unless --risky or --category is set',
    );
    expect(source).toContain('irreversible items need their own --category');
    expect(source).toContain('.venv/venv are never auto-picked');
  });
});

describe('clean --deep help', () => {
  it('says --yes also needs the electron category, like the README', () => {
    expect(read('src/index.ts')).toContain('--category electron');
  });
});

describe('risky gate wording', () => {
  const flat = (name: string) => read(name).replace(/\s+/g, ' ');

  it('says a named --category lifts the risky filter, in the README safety list', () => {
    expect(flat('README.md')).toContain(
      'Risky items are excluded from cleanup unless you pass `--risky` or name their `--category`',
    );
  });

  it('says --deep state needs --risky or the electron category, in the help and the changelog', () => {
    expect(flat('src/index.ts')).toContain('needs --risky or --category electron');
    expect(flat('CHANGELOG.md')).toContain('without `--risky` or `--category electron`');
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
