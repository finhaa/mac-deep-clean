import path from 'node:path';
import { checkbox, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { ProjectArtifactsScanner } from '../scanners/project-artifacts.js';
import type { ScanResult } from '../types.js';
import { isDirectory } from '../utils/fs.js';
import { colorSize, formatBytes, truncate } from '../utils/format.js';
import { HOME } from '../utils/paths.js';

interface PurgeOptions {
  dryRun?: boolean;
  yes?: boolean;
  path?: string[];
}

export async function purgeCommand(options: PurgeOptions = {}): Promise<void> {
  console.log(chalk.bold.cyan('\n🗑  mac-deep-clean purge — project build artifacts\n'));
  if (options.dryRun) console.log(chalk.yellow('DRY RUN — no files will be deleted.\n'));

  const scanner = new ProjectArtifactsScanner();
  if (options.path && options.path.length > 0) {
    const resolved: string[] = [];
    for (const p of options.path) {
      const expanded = expandHome(p);
      if (!(await isDirectory(expanded))) {
        console.error(chalk.red(`Not a directory: ${expanded}`));
        process.exitCode = 1;
        return;
      }
      resolved.push(expanded);
    }
    scanner.searchRoots = resolved;
  }

  const spinner = ora('Walking project roots…').start();
  const results = await scanner.scan();
  spinner.succeed(`Found ${results.length} build artifact dir(s)`);

  if (results.length === 0) {
    console.log(chalk.green('\n✓ Nothing to purge.\n'));
    return;
  }

  const total = results.reduce((s, r) => s + r.size, 0);
  console.log(`\n${chalk.bold('Total reclaimable:')} ${colorSize(total)}\n`);

  let selected: ScanResult[];

  if (options.yes) {
    for (const r of results.slice(0, 30)) {
      console.log(`  ${chalk.grey('•')} ${truncate(r.label, 60).padEnd(62)} ${colorSize(r.size)}`);
    }
    if (results.length > 30) {
      console.log(chalk.grey(`  … and ${results.length - 30} more`));
    }
    selected = results;
  } else {
    const choices = results.map((r, idx) => ({
      name: `${truncate(r.label, 60).padEnd(62)} ${colorSize(r.size)}`,
      value: idx,
      checked: true,
    }));

    const selectedIdx = await checkbox<number>({
      message: `Select dirs to delete (${formatBytes(total)} total):`,
      choices,
      pageSize: 20,
      loop: false,
    });

    selected = selectedIdx.map((i) => results[i]).filter(Boolean) as ScanResult[];
  }

  if (selected.length === 0) {
    console.log(chalk.grey('\nNothing selected. Exiting.\n'));
    return;
  }

  const selectedTotal = selected.reduce((s, r) => s + r.size, 0);
  console.log(
    `\n${chalk.bold('Selected:')} ${selected.length} dir(s) — ${colorSize(selectedTotal)} to free`,
  );

  if (!options.yes && !options.dryRun) {
    const ok = await confirm({
      message: `Proceed with deletion? (${formatBytes(selectedTotal)})`,
      default: false,
    });
    if (!ok) {
      console.log(chalk.grey('Cancelled.\n'));
      return;
    }
  }

  await deleteAll(selected, options.dryRun ?? false);
}

async function deleteAll(results: ScanResult[], dryRun: boolean): Promise<void> {
  const fs = await import('node:fs/promises');
  const { assertSafeToDelete } = await import('../utils/paths.js');
  let freed = 0;
  const errors: string[] = [];
  const spinner = ora(`Deleting ${results.length} dirs…`).start();
  for (const r of results) {
    try {
      assertSafeToDelete(r.path);
      if (!dryRun) await fs.rm(r.path, { recursive: true, force: true });
      freed += r.size;
    } catch (err) {
      errors.push(`${r.path}: ${(err as Error).message}`);
    }
  }
  spinner.succeed(`Freed ${formatBytes(freed)}${dryRun ? ' (dry run)' : ''}`);
  if (errors.length > 0) {
    console.log(chalk.yellow(`\n${errors.length} warning(s):`));
    for (const e of errors.slice(0, 20)) console.log(`  ${chalk.yellow('⚠')} ${e}`);
  }
  console.log();
}

function expandHome(p: string): string {
  if (p === '~') return HOME;
  if (p.startsWith('~/')) return path.join(HOME, p.slice(2));
  return path.resolve(p);
}
