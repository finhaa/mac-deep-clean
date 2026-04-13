import { checkbox, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { getAllScanners } from '../scanners/index.js';
import { runScanners } from '../runner.js';
import type { CleanOptions, ScannerReport, ScanResult } from '../types.js';
import { colorRisk, colorSize, formatBytes, truncate } from '../utils/format.js';
import { partitionCleanable } from '../utils/partition.js';
import { flushWarnings } from '../utils/warnings.js';

export async function cleanCommand(options: CleanOptions = {}): Promise<void> {
  console.log(chalk.bold.cyan('\n🧹 mac-deep-clean\n'));
  if (options.dryRun) console.log(chalk.yellow('DRY RUN — no files will be deleted.\n'));
  if (options.deep)
    console.log(
      chalk.yellow(
        'DEEP mode: Electron app full-state entries will appear — review carefully before selecting.\n',
      ),
    );

  let scanners = getAllScanners();
  if (options.category) {
    scanners = scanners.filter((s) => s.category === options.category);
    if (scanners.length === 0) {
      console.error(chalk.red(`No scanner matches category: ${options.category}`));
      process.exitCode = 1;
      return;
    }
  }
  if (!options.risky && !options.category) {
    scanners = scanners.filter((s) => s.risk !== 'risky');
  }

  const rawReports = await runScanners(scanners, { deep: options.deep });
  const { reports, infoItems } = partitionCleanable(rawReports);
  const warnings = flushWarnings();
  if (warnings.length > 0) {
    console.log(chalk.yellow('\nWarnings:'));
    for (const w of warnings) console.log(`  ${chalk.yellow('⚠')} ${w}`);
  }
  if (infoItems.length > 0) {
    const infoTotal = infoItems.reduce((s, i) => s + i.size, 0);
    console.log(
      `\n${chalk.grey(`ℹ Not cleanable by this tool — ${formatBytes(infoTotal)}:`)}`,
    );
    for (const item of infoItems) {
      console.log(
        `  ${chalk.grey('•')} ${truncate(item.label, 50).padEnd(52)} ${colorSize(item.size)}`,
      );
      if (item.description) console.log(`    ${chalk.grey(item.description)}`);
    }
  }
  const nonEmpty = reports.filter((r) => r.results.length > 0 && r.totalSize > 0);
  if (nonEmpty.length === 0) {
    console.log(chalk.green('\n✓ Nothing to clean.\n'));
    return;
  }

  let selected: ScanResult[];

  if (options.yes) {
    selected = nonEmpty.flatMap((r) => r.results);
  } else {
    selected = await promptSelection(nonEmpty);
  }

  if (selected.length === 0) {
    console.log(chalk.grey('\nNothing selected. Exiting.\n'));
    return;
  }

  const total = selected.reduce((s, r) => s + r.size, 0);
  console.log(
    `\n${chalk.bold('Selected:')} ${selected.length} item(s) — ${colorSize(total)} to free`,
  );

  if (!options.yes && !options.dryRun) {
    const ok = await confirm({
      message: `Proceed with cleanup? (${formatBytes(total)})`,
      default: false,
    });
    if (!ok) {
      console.log(chalk.grey('Cancelled.\n'));
      return;
    }
  }

  await executeCleanup(reports, selected, options.dryRun ?? false);
}

async function promptSelection(reports: ScannerReport[]): Promise<ScanResult[]> {
  const picked: ScanResult[] = [];
  for (const report of reports) {
    console.log(
      `\n${chalk.bold(report.name)} ${chalk.grey(`(${report.category})`)} — ${colorSize(report.totalSize)} ${chalk.grey(`[${colorRisk(report.risk)}]`)}`,
    );
    console.log(chalk.grey(`  ${report.description}`));

    const choices = report.results.map((r, idx) => ({
      name: `${truncate(r.label, 50).padEnd(52)} ${colorSize(r.size)}`,
      value: idx,
      checked: report.risk === 'safe',
    }));

    const selectedIdx = await checkbox<number>({
      message: `Select items from ${report.name}:`,
      choices,
      pageSize: 15,
      loop: false,
    });
    for (const i of selectedIdx) {
      const item = report.results[i];
      if (item) picked.push(item);
    }
  }
  return picked;
}

async function executeCleanup(
  reports: ScannerReport[],
  selected: ScanResult[],
  dryRun: boolean,
): Promise<void> {
  const scanners = getAllScanners();
  const byCategory = new Map<string, ScanResult[]>();
  for (const r of selected) {
    const list = byCategory.get(r.category) ?? [];
    list.push(r);
    byCategory.set(r.category, list);
  }

  let totalFreed = 0;
  const allErrors: string[] = [];

  for (const [category, items] of byCategory) {
    const scanner = scanners.find((s) => s.category === category);
    if (!scanner) continue;
    const spinner = ora(`Cleaning ${scanner.name}…`).start();
    try {
      const { freed, errors } = await scanner.clean(items, dryRun);
      totalFreed += freed;
      allErrors.push(...errors);
      spinner.succeed(`${scanner.name}: freed ${formatBytes(freed)}`);
    } catch (err) {
      spinner.fail(`${scanner.name}: ${(err as Error).message}`);
      allErrors.push(`${scanner.name}: ${(err as Error).message}`);
    }
  }

  // Report for unused variable (keeps types aligned with future extensions)
  void reports;

  console.log(
    `\n${chalk.bold.green('✓ Done.')} Freed ${chalk.bold(colorSize(totalFreed))}${dryRun ? chalk.yellow(' (dry run)') : ''}`,
  );
  if (allErrors.length > 0) {
    console.log(chalk.yellow(`\n${allErrors.length} warning(s):`));
    for (const e of allErrors.slice(0, 20)) console.log(`  ${chalk.yellow('⚠')} ${e}`);
    if (allErrors.length > 20) console.log(chalk.grey(`  … and ${allErrors.length - 20} more`));
  }
  console.log();
}
