import { afterEach, describe, expect, it, vi } from 'vitest';
import { asInvokingUser, run, shellQuote } from './exec.js';

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

  it('refuses a SUDO_USER that is not a plain user name instead of building the command', () => {
    asRoot('rafa; touch /tmp/pwned');
    expect(() => asInvokingUser('brew cleanup')).toThrow(/SUDO_USER/);
    asRoot('rafa$(id)');
    expect(() => asInvokingUser('brew cleanup')).toThrow(/SUDO_USER/);
    for (const hostile of [
      'rafa;id',
      'rafa&id',
      'rafa|id',
      'rafa`id`',
      'rafa\nid',
      'ra fa',
      '.',
      '..',
      'a/b',
      '../etc',
    ]) {
      asRoot(hostile);
      expect(() => asInvokingUser('brew cleanup'), JSON.stringify(hostile)).toThrow(/SUDO_USER/);
    }
  });

  it('refuses a SUDO_USER that carries a dollar sign, which the shell would expand', () => {
    asRoot('rafa$HOME');
    expect(() => asInvokingUser('brew cleanup')).toThrow(/SUDO_USER/);
    asRoot('$USER');
    expect(() => asInvokingUser('brew cleanup')).toThrow(/SUDO_USER/);
  });

  it('accepts the characters a plain user name may hold', () => {
    asRoot('Rafa.Lima_2-b');
    expect(asInvokingUser('x')).toBe(`sudo -u Rafa.Lima_2-b -H bash -lc 'x'`);
  });

  it('leaves the command alone for any non-root uid and where getuid does not exist', () => {
    process.getuid = () => 502;
    vi.stubEnv('SUDO_USER', 'rafa');
    expect(asInvokingUser('brew cleanup')).toBe('brew cleanup');
    process.getuid = undefined as unknown as typeof process.getuid;
    expect(asInvokingUser('brew cleanup')).toBe('brew cleanup');
  });

  it('re-runs the command as the invoking user under sudo and escapes single quotes', () => {
    asRoot('rafa');
    expect(asInvokingUser("echo 'hi'")).toBe(`sudo -u rafa -H bash -lc 'echo '\\''hi'\\'''`);
  });
});

describe('shellQuote', () => {
  it.each([
    'plain',
    "it's",
    'a "double" quote',
    '$(touch /tmp/pwned)',
    '`touch /tmp/pwned`',
    'semi; colon && pipe | amp &',
    'new\nline',
    '$HOME \\ backslash',
    '-leading-dash',
  ])('hands %j to the command exactly as given', async (value) => {
    const { stdout, code } = await run(`printf %s ${shellQuote(value)}`);
    expect(code).toBe(0);
    expect(stdout).toBe(value);
  });
});
