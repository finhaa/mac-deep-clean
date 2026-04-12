import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export async function run(
  command: string,
  options: { timeout?: number; cwd?: string } = {},
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: options.timeout ?? 30_000,
      cwd: options.cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message,
      code: typeof e.code === 'number' ? e.code : 1,
    };
  }
}

export async function commandExists(cmd: string): Promise<boolean> {
  const { code } = await run(`command -v ${cmd}`, { timeout: 2000 });
  return code === 0;
}
