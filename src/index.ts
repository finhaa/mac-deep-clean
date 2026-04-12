#!/usr/bin/env node
import { Command } from 'commander';
import { cleanCommand } from './commands/clean.js';
import { doctorCommand } from './commands/doctor.js';
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
  .action(async (opts) => {
    await cleanCommand(opts);
  });

program
  .command('doctor')
  .description('Full system disk diagnostic with recommendations')
  .action(async () => {
    await doctorCommand();
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
