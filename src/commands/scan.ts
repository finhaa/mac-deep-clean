import chalk from 'chalk';
import Table from 'cli-table3';
import { getAllScanners } from '../scanners/index.js';
import { colorRisk, colorSize, formatBytes, truncate } from '../utils/format.js';
import { partitionCleanable } from '../utils/partition.js';
import { flushWarnings } from '../utils/warnings.js';
import { runScanners } from '../runner.js';

export async function scanCommand(
  options: { category?: string; deep?: boolean } = {},
): Promise<void> {
  console.log(chalk.bold.cyan('\n🔍 Scanning your Mac...\n'));
  if (options.deep) {
    console.log(
      chalk.yellow(
        'DEEP mode: Electron apps will also report full state (risky — reviewer recommended).\n',
      ),
    );
  }

  let scanners = getAllScanners();
  if (options.category) {
    scanners = scanners.filter((s) => s.category === options.category);
    if (scanners.length === 0) {
      console.error(chalk.red(`No scanner matches category: ${options.category}`));
      process.exitCode = 1;
      return;
    }
  }

  const rawReports = await runScanners(scanners, { deep: options.deep });
  const { reports, infoItems } = partitionCleanable(rawReports);

  const sorted = [...reports].sort((a, b) => b.totalSize - a.totalSize);

  const table = new Table({
    head: [chalk.bold('Category'), chalk.bold('Size'), chalk.bold('Risk'), chalk.bold('Items')],
    colWidths: [38, 14, 12, 8],
    style: { head: [], border: ['grey'] },
  });

  for (const r of sorted) {
    table.push([
      truncate(r.name, 36),
      colorSize(r.totalSize),
      colorRisk(r.risk),
      String(r.results.length),
    ]);
  }
  console.log(table.toString());

  const total = reports.reduce((s, r) => s + r.totalSize, 0);
  console.log(`\n${chalk.bold('Total cleanable:')} ${chalk.bold(colorSize(total))}`);

  for (const r of sorted) {
    if (r.results.length === 0 || r.totalSize === 0) continue;
    console.log(`\n${chalk.bold(r.name)} ${chalk.grey(`(${r.category})`)}`);
    for (const item of r.results.slice(0, 8)) {
      console.log(
        `  ${chalk.grey('├─')} ${truncate(item.label, 50).padEnd(52)} ${colorSize(item.size)}`,
      );
    }
    if (r.results.length > 8) {
      console.log(`  ${chalk.grey('└─')} ${chalk.grey(`… and ${r.results.length - 8} more`)}`);
    }
  }

  if (infoItems.length > 0) {
    const infoTotal = infoItems.reduce((s, i) => s + i.size, 0);
    console.log(
      `\n${chalk.grey(`ℹ Not cleanable by this tool — ${formatBytes(infoTotal)}`)}`,
    );
    for (const item of infoItems) {
      console.log(
        `  ${chalk.grey('•')} ${truncate(item.label, 50).padEnd(52)} ${colorSize(item.size)}`,
      );
      if (item.description) console.log(`    ${chalk.grey(item.description)}`);
    }
  }

  const errored = reports.filter((r) => r.error);
  if (errored.length > 0) {
    console.log(chalk.yellow('\nErrors:'));
    for (const r of errored) console.log(`  ${chalk.yellow('⚠')} ${r.name}: ${r.error}`);
  }

  const warnings = flushWarnings();
  if (warnings.length > 0) {
    console.log(chalk.yellow('\nWarnings:'));
    for (const w of warnings) console.log(`  ${chalk.yellow('⚠')} ${w}`);
  }

  console.log(
    chalk.grey(
      `\nRun ${chalk.cyan('mac-deep-clean clean')} to interactively select what to remove.`,
    ),
  );
  console.log(chalk.grey(`Estimated: ${formatBytes(total)}\n`));
}
