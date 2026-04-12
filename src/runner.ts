import ora from 'ora';
import type { BaseScanner } from './scanners/index.js';
import type { ScanOptions, ScannerReport } from './types.js';

export async function runScanners(
  scanners: BaseScanner[],
  options: ScanOptions = {},
): Promise<ScannerReport[]> {
  const reports: ScannerReport[] = [];
  for (const scanner of scanners) {
    const spinner = ora(`Scanning ${scanner.name}…`).start();
    try {
      const results = await scanner.scan(options);
      const totalSize = results.reduce((sum, r) => sum + r.size, 0);
      reports.push({
        name: scanner.name,
        category: scanner.category,
        description: scanner.description,
        risk: scanner.risk,
        results,
        totalSize,
      });
      spinner.succeed(`${scanner.name}: ${results.length} item(s)`);
    } catch (err) {
      const message = (err as Error).message;
      reports.push({
        name: scanner.name,
        category: scanner.category,
        description: scanner.description,
        risk: scanner.risk,
        results: [],
        totalSize: 0,
        error: message,
      });
      spinner.fail(`${scanner.name}: ${message}`);
    }
  }
  return reports;
}
