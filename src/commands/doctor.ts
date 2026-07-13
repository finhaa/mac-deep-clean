import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { runScanners } from '../runner.js';
import { getAllScanners } from '../scanners/index.js';
import { run } from '../utils/exec.js';
import { colorRisk, colorSize, formatBytes } from '../utils/format.js';
import { getSize, pathExists } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';

interface DiskInfo {
  total: number;
  used: number;
  free: number;
  percentUsed: number;
}

async function getDiskInfo(): Promise<DiskInfo | null> {
  const { stdout, code } = await run('df -k /', { timeout: 5000 });
  if (code !== 0) return null;
  const lines = stdout.trim().split('\n');
  if (lines.length < 2) return null;
  const parts = lines[1]!.split(/\s+/);
  const total = Number.parseInt(parts[1] ?? '0', 10) * 1024;
  const used = Number.parseInt(parts[2] ?? '0', 10) * 1024;
  const free = Number.parseInt(parts[3] ?? '0', 10) * 1024;
  return {
    total,
    used,
    free,
    percentUsed: total > 0 ? (used / total) * 100 : 0,
  };
}

async function topHomeConsumers(): Promise<Array<{ path: string; size: number }>> {
  const candidates = [
    'Library/Application Support',
    'Library/Containers',
    'Library/Group Containers',
    'Library/Caches',
    'Library/Developer',
    'Library/Logs',
    'Documents',
    'Downloads',
    'Movies',
    'Pictures',
  ];
  const results: Array<{ path: string; size: number }> = [];
  for (const rel of candidates) {
    const target = path.join(HOME, rel);
    if (!(await pathExists(target))) continue;
    const size = await getSize(target);
    results.push({ path: `~/${rel}`, size });
  }
  return results.sort((a, b) => b.size - a.size);
}

export async function doctorCommand(): Promise<void> {
  console.log(chalk.bold.cyan('\n🩺 System Diagnostic\n'));

  const diskSpinner = ora('Checking disk…').start();
  const disk = await getDiskInfo();
  diskSpinner.stop();

  if (disk) {
    const freePct = 100 - disk.percentUsed;
    console.log(
      `${chalk.bold('Disk:')} ${formatBytes(disk.total)} total | ${formatBytes(disk.used)} used | ${formatBytes(disk.free)} free (${freePct.toFixed(1)}%)`,
    );
    if (freePct < 10) console.log(chalk.red.bold('⚠️  Low disk space!'));
    else if (freePct < 20) console.log(chalk.yellow('⚠ Disk filling up'));
  }

  const topSpinner = ora('Computing top space consumers…').start();
  const top = await topHomeConsumers();
  topSpinner.succeed('Top consumers:');
  for (const [i, entry] of top.slice(0, 8).entries()) {
    console.log(`  ${chalk.grey(`${i + 1}.`)} ${entry.path.padEnd(38)} ${colorSize(entry.size)}`);
  }

  console.log(chalk.bold.cyan('\nRunning scanners…\n'));
  const reports = await runScanners(getAllScanners());
  const sorted = [...reports].sort((a, b) => b.totalSize - a.totalSize);

  console.log(chalk.bold('\nRecommendations:'));
  let hasRec = false;
  for (const r of sorted) {
    if (r.totalSize < 1024 ** 3) continue;
    hasRec = true;
    const marker = r.risk === 'risky' ? chalk.red('⚠') : chalk.yellow('⚠');
    console.log(
      `  ${marker} ${r.name}: ${colorSize(r.totalSize)} ${chalk.grey(`[${colorRisk(r.risk)}]`)} — ${chalk.cyan(`mac-deep-clean clean --category ${r.category}`)}`,
    );
  }
  if (!hasRec) console.log(chalk.green('  ✓ Nothing significant to recommend.'));

  const total = reports.reduce((s, r) => s + r.totalSize, 0);
  console.log(`\n${chalk.bold('Total potential:')} ${colorSize(total)}\n`);
}
