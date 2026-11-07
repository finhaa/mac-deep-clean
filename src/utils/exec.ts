import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Single-quotes `value` for a shell command line; nothing inside single quotes is interpreted. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export const USER_NAME = /^[A-Za-z0-9._-]+$/;

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

/**
 * When running under sudo, re-run the command as the original invoking user
 * via `sudo -u $SUDO_USER -H`. This is needed for tools that refuse to run
 * as root (Homebrew) or that can't find developer utilities in root's PATH
 * (xcrun). When not under sudo, returns the command unchanged.
 */
export function asInvokingUser(command: string): string {
  const sudoUser = process.env.SUDO_USER;
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (!isRoot || !sudoUser || sudoUser === 'root') return command;
  if (!USER_NAME.test(sudoUser)) throw new Error(`SUDO_USER is not a plain user name: ${sudoUser}`);
  return `sudo -u ${sudoUser} -H bash -lc ${shellQuote(command)}`;
}
