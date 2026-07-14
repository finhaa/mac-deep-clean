import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { colorSize, formatBytes, truncate } from '../utils/format.js';
import { isDirectory } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';

interface DuplicatesOptions {
  minSize?: string;
  top?: string;
}

const DEFAULT_MIN_BYTES = 1024 * 1024;
const DEFAULT_TOP_GROUPS = 20;
const SKIP_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.next',
  '.nuxt',
  'target',
  'Pods',
  '.gradle',
  '.terraform',
  '.cache',
  'DerivedData',
]);

interface FileEntry {
  path: string;
  size: number;
}

export async function duplicatesCommand(
  searchPath: string,
  options: DuplicatesOptions = {},
): Promise<void> {
  console.log(chalk.bold.cyan('\n🔍 mac-deep-clean duplicates (read-only)\n'));

  const root = expandHome(searchPath);
  if (!(await isDirectory(root))) {
    console.error(chalk.red(`Not a directory: ${root}`));
    process.exitCode = 1;
    return;
  }

  const minSize = options.minSize ? parseSize(options.minSize) : DEFAULT_MIN_BYTES;
  const topN = options.top ? Number.parseInt(options.top, 10) : DEFAULT_TOP_GROUPS;

  console.log(
    chalk.grey(
      `Scanning ${root}\n` +
        `  min file size: ${formatBytes(minSize)}\n` +
        `  top groups:    ${topN}\n` +
        `  skip dirs:     ${[...SKIP_DIR_NAMES].slice(0, 6).join(', ')}, …\n`,
    ),
  );

  const walkSpinner = ora('Walking files…').start();
  const files: FileEntry[] = [];
  await walk(root, files, minSize);
  walkSpinner.succeed(`Found ${files.length} candidate file(s) ≥ ${formatBytes(minSize)}`);

  const bySize = new Map<number, FileEntry[]>();
  for (const f of files) {
    const list = bySize.get(f.size) ?? [];
    list.push(f);
    bySize.set(f.size, list);
  }

  const sizeGroups = [...bySize.values()].filter((g) => g.length > 1);
  if (sizeGroups.length === 0) {
    console.log(chalk.green('\n✓ No duplicate candidates by size.\n'));
    return;
  }

  const hashSpinner = ora(`Hashing ${sizeGroups.flat().length} candidate(s)…`).start();
  const byHash = new Map<string, FileEntry[]>();
  for (const group of sizeGroups) {
    for (const file of group) {
      const hash = await sha256(file.path);
      if (!hash) continue;
      const key = `${file.size}:${hash}`;
      const list = byHash.get(key) ?? [];
      list.push(file);
      byHash.set(key, list);
    }
  }
  hashSpinner.succeed(`Hashed ${sizeGroups.flat().length} file(s)`);

  const dupGroups = [...byHash.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({ files: g, wasted: (g.length - 1) * (g[0]?.size ?? 0) }))
    .sort((a, b) => b.wasted - a.wasted);

  if (dupGroups.length === 0) {
    console.log(chalk.green('\n✓ No actual duplicates found.\n'));
    return;
  }

  const totalWasted = dupGroups.reduce((s, g) => s + g.wasted, 0);
  console.log(
    `\n${chalk.bold(dupGroups.length)} duplicate group(s) — ${chalk.bold(colorSize(totalWasted))} wasted\n`,
  );

  for (const group of dupGroups.slice(0, topN)) {
    const first = group.files[0];
    if (!first) continue;
    console.log(
      `${chalk.bold(`${group.files.length}× ${formatBytes(first.size)}`)} ${chalk.grey(`(${formatBytes(group.wasted)} wasted)`)}`,
    );
    for (const f of group.files) {
      console.log(`  ${chalk.grey('•')} ${truncate(displayPath(f.path), 100)}`);
    }
    console.log();
  }

  if (dupGroups.length > topN) {
    console.log(chalk.grey(`… and ${dupGroups.length - topN} more group(s)`));
  }

  console.log(
    chalk.grey(
      'Read-only report. Review and delete manually — mac-deep-clean does not delete duplicates automatically.',
    ),
  );
}

async function walk(dir: string, out: FileEntry[], minSize: number): Promise<void> {
  let entries: Array<{
    name: string;
    isDirectory: () => boolean;
    isFile: () => boolean;
    isSymbolicLink: () => boolean;
  }>;
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })) as typeof entries;
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await walk(full, out, minSize);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const stat = await fs.lstat(full);
      if (stat.size >= minSize) {
        out.push({ path: full, size: stat.size });
      }
    } catch {
      // skip
    }
  }
}

function sha256(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', () => resolve(null));
  });
}

function parseSize(input: string): number {
  const match = input.match(/^(\d+(?:\.\d+)?)\s*([KMGT]?B?)$/i);
  if (!match) return DEFAULT_MIN_BYTES;
  const value = Number.parseFloat(match[1]!);
  const unit = match[2]!.toUpperCase();
  const multipliers: Record<string, number> = {
    '': 1,
    B: 1,
    K: 1024,
    KB: 1024,
    M: 1024 ** 2,
    MB: 1024 ** 2,
    G: 1024 ** 3,
    GB: 1024 ** 3,
    T: 1024 ** 4,
    TB: 1024 ** 4,
  };
  return Math.round(value * (multipliers[unit] ?? 1));
}

function displayPath(p: string): string {
  if (p.startsWith(HOME)) return `~${p.slice(HOME.length)}`;
  return p;
}

function expandHome(p: string): string {
  if (p === '~') return HOME;
  if (p.startsWith('~/')) return path.join(HOME, p.slice(2));
  return path.resolve(p);
}
