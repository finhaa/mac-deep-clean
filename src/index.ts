#!/usr/bin/env node
import { Command } from 'commander';
import { cleanCommand } from './commands/clean.js';
import { doctorCommand } from './commands/doctor.js';
import { duplicatesCommand } from './commands/duplicates.js';
import { purgeCommand } from './commands/purge.js';
import { scanCommand } from './commands/scan.js';

const program = new Command();

program
  .name('mac-deep-clean')
  .description('CLI that cleans what other Mac cleaners miss')
  .version('0.1.0');

program
  .command('scan')
  .description('Scan your Mac and report reclaimable space')
  .option('-c, --category <name>', 'Only scan a specific category')
  .option('--deep', 'Include full Electron app state (conversations, workspaces) — risky')
  .action(async (opts) => {
    await scanCommand(opts);
  });

program
  .command('clean')
  .description('Interactively clean caches and reclaim space')
  .option('--dry-run', 'Preview only — no files deleted')
  .option('--risky', 'Include risky categories (docker, etc.)')
  .option('-y, --yes', 'Skip confirmation (non-interactive)')
  .option('-c, --category <name>', 'Only clean a specific category')
  .option('--deep', 'Include full Electron app state — requires --risky to clean')
  .action(async (opts) => {
    await cleanCommand(opts);
  });

program
  .command('doctor')
  .description('Full system disk diagnostic with recommendations')
  .action(async () => {
    await doctorCommand();
  });

program
  .command('purge')
  .description('Find and delete project build artifacts (node_modules, .venv, target, Pods…)')
  .option('--dry-run', 'Preview only — no files deleted')
  .option('-y, --yes', 'Skip confirmation')
  .option('-p, --path <dir...>', 'Override search roots (default: ~/code, ~/Projects, ~/dev, …)')
  .action(async (opts) => {
    await purgeCommand(opts);
  });

program
  .command('duplicates <path>')
  .description('Find duplicate files (read-only report, no deletion)')
  .option('--min-size <size>', 'Minimum file size (e.g. 1MB, 500K)', '1MB')
  .option('--top <n>', 'Show top N duplicate groups', '20')
  .action(async (path, opts) => {
    await duplicatesCommand(path, opts);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
