import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  clean: vi.fn(),
  doctor: vi.fn(),
  duplicates: vi.fn(),
  purge: vi.fn(),
  scan: vi.fn(),
}));

vi.mock('./commands/clean.js', () => ({ cleanCommand: calls.clean }));
vi.mock('./commands/doctor.js', () => ({ doctorCommand: calls.doctor }));
vi.mock('./commands/duplicates.js', () => ({ duplicatesCommand: calls.duplicates }));
vi.mock('./commands/purge.js', () => ({ purgeCommand: calls.purge }));
vi.mock('./commands/scan.js', () => ({ scanCommand: calls.scan }));

const realArgv = process.argv;

async function cli(...args: string[]): Promise<void> {
  process.argv = ['node', 'mac-deep-clean', ...args];
  vi.resetModules();
  await import('./index.js');
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockReset();
});

afterEach(() => {
  process.argv = realArgv;
});

describe('--version', () => {
  it('prints the version from package.json, not a copy of it', async () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    try {
      await cli('--version');
      expect(write.mock.calls.map((c) => String(c[0])).join('')).toContain(pkg.version);
    } finally {
      write.mockRestore();
      exit.mockRestore();
    }
  });
});

describe('command line wiring', () => {
  it('passes every clean flag through', async () => {
    await cli('clean', '--dry-run', '--risky', '-y', '-c', 'logs', '--deep');
    expect(calls.clean).toHaveBeenCalledWith({
      dryRun: true,
      risky: true,
      yes: true,
      category: 'logs',
      deep: true,
    });
  });

  it('runs clean with no flags set', async () => {
    await cli('clean');
    expect(calls.clean).toHaveBeenCalledWith({});
  });

  it('passes scan options through', async () => {
    await cli('scan', '-c', 'docker', '--deep');
    expect(calls.scan).toHaveBeenCalledWith({ category: 'docker', deep: true });
  });

  it('passes purge paths, excludes and flags through as lists', async () => {
    await cli('purge', '--dry-run', '-y', '-p', '/a', '/b', '-x', '/c');
    expect(calls.purge).toHaveBeenCalledWith({
      dryRun: true,
      yes: true,
      path: ['/a', '/b'],
      exclude: ['/c'],
    });
  });

  it('passes the duplicates path and its options, with defaults', async () => {
    await cli('duplicates', '/some/dir');
    expect(calls.duplicates).toHaveBeenCalledWith('/some/dir', { minSize: '1MB', top: '20' });
    await cli('duplicates', '/other', '--min-size', '5MB', '--top', '3');
    expect(calls.duplicates).toHaveBeenLastCalledWith('/other', { minSize: '5MB', top: '3' });
  });

  it('prints the error and exits with code 1 when a command rejects', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error('boom');
    calls.clean.mockRejectedValue(failure);
    try {
      await cli('clean');
      expect(error).toHaveBeenCalledWith(failure);
      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });

  it('does not exit by itself when the command succeeds', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    try {
      await cli('doctor');
      expect(exit).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
    }
  });

  it('runs doctor', async () => {
    await cli('doctor');
    expect(calls.doctor).toHaveBeenCalledTimes(1);
  });
});
