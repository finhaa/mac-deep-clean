import { afterEach, describe, expect, it, vi } from 'vitest';
import { asInvokingUser, commandExists, run } from './exec.js';

describe('run', () => {
  it('returns stdout and code 0 on success', async () => {
    expect(await run('echo hello')).toEqual({ stdout: 'hello\n', stderr: '', code: 0 });
  });

  it('returns the exit code, stdout and stderr of a failing command instead of throwing', async () => {
    const result = await run('echo out; echo err >&2; exit 3');
    expect(result.code).toBe(3);
    expect(result.stdout).toBe('out\n');
    expect(result.stderr).toBe('err\n');
  });

  it('gives up on a command that outlives the timeout and reports a non-zero code', async () => {
    const result = await run('sleep 5', { timeout: 100 });
    expect(result.code).not.toBe(0);
  });

  it('runs in the given directory', async () => {
    expect((await run('pwd', { cwd: '/' })).stdout.trim()).toBe('/');
  });
});

describe('commandExists', () => {
  it('is true for a command on the PATH and false for one that is not', async () => {
    expect(await commandExists('node')).toBe(true);
    expect(await commandExists('mdc-no-such-command')).toBe(false);
  });
});

describe('asInvokingUser', () => {
  const realUid = process.getuid;

  afterEach(() => {
    process.getuid = realUid;
    vi.unstubAllEnvs();
  });

  function asRoot(sudoUser: string | undefined) {
    process.getuid = () => 0;
    vi.stubEnv('SUDO_USER', sudoUser);
  }

  it('leaves the command alone when not running as root', () => {
    process.getuid = () => 501;
    vi.stubEnv('SUDO_USER', 'rafa');
    expect(asInvokingUser('brew cleanup')).toBe('brew cleanup');
  });

  it('leaves the command alone as root without SUDO_USER or when SUDO_USER is root', () => {
    asRoot(undefined);
    expect(asInvokingUser('brew cleanup')).toBe('brew cleanup');
    asRoot('root');
    expect(asInvokingUser('brew cleanup')).toBe('brew cleanup');
  });

  it('re-runs the command as the invoking user under sudo and escapes single quotes', () => {
    asRoot('rafa');
    expect(asInvokingUser("echo 'hi'")).toBe(`sudo -u rafa -H bash -lc 'echo '\\''hi'\\'''`);
  });
});
