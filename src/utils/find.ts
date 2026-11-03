import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type FindRunner = (args: string[]) => Promise<string>;

// No shell, so a path cannot be reinterpreted. find exits 1 when it meets an unreadable directory
// but still prints the rest; on a timeout or a full buffer the output is cut, which parseRecords
// handles by dropping the unterminated tail.
async function runFind(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('find', args, {
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    return (err as { stdout?: string }).stdout ?? '';
  }
}

// -print0 ends every record with NUL, the one byte a file name cannot hold. Whatever follows the
// last NUL was cut off mid-path and must never be treated as a path.
function parseRecords(stdout: string): string[] {
  const records = stdout.split('\0');
  records.pop();
  return records;
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/**
 * Directories named one of `names` under `root`, never descending into a match.
 * Every returned path is strictly inside `root` and ends in one of `names`.
 */
export async function findDirsNamed(
  root: string,
  names: readonly string[],
  maxDepth: number,
  runner: FindRunner = runFind,
): Promise<string[]> {
  const nameExpr = names.flatMap((name, i) => (i === 0 ? ['-name', name] : ['-o', '-name', name]));
  const stdout = await runner([
    root,
    '-maxdepth',
    String(maxDepth),
    '-type',
    'd',
    '(',
    ...nameExpr,
    ')',
    '-prune',
    '-print0',
  ]);
  const found = parseRecords(stdout).filter(
    (record) => names.includes(path.basename(record)) && isInside(root, record),
  );
  return [...new Set(found)];
}
