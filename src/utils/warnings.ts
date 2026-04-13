import path from 'node:path';
import { HOME } from './paths.js';

type WarningKind = 'fda' | 'sudo' | 'other';

interface PermissionWarning {
  kind: WarningKind;
  path: string;
}

const warnings: PermissionWarning[] = [];

export function addPermissionWarning(target: string): void {
  warnings.push({ kind: inferKind(target), path: target });
}

function inferKind(target: string): WarningKind {
  const resolved = path.resolve(target);
  if (
    resolved.startsWith('/Library') ||
    resolved.startsWith('/private') ||
    resolved.startsWith('/System') ||
    resolved.startsWith('/usr')
  ) {
    return 'sudo';
  }
  if (resolved.startsWith(path.join(HOME, 'Library'))) return 'fda';
  return 'other';
}

export function flushWarnings(): string[] {
  const fda = warnings.filter((w) => w.kind === 'fda').map((w) => displayPath(w.path));
  const sudo = warnings.filter((w) => w.kind === 'sudo').map((w) => displayPath(w.path));
  const other = warnings.filter((w) => w.kind === 'other').map((w) => displayPath(w.path));
  warnings.length = 0;

  const out: string[] = [];
  if (fda.length > 0) {
    out.push(
      `${fda.length} path(s) under ~/Library need Full Disk Access:\n` +
        `    ${sample(fda)}\n` +
        '    Fix: System Settings → Privacy & Security → Full Disk Access\n' +
        `    → add your terminal (you're running in ${terminalName()}) and restart it.`,
    );
  }
  if (sudo.length > 0) {
    out.push(
      `${sudo.length} system path(s) are root-owned — FDA can't fix these:\n` +
        `    ${sample(sudo)}\n` +
        '    Fix: re-run with sudo to get accurate sizes on these paths.',
    );
  }
  if (other.length > 0) {
    out.push(
      `${other.length} other path(s) were unreadable:\n    ${sample(other)}`,
    );
  }
  return out;
}

export function hasWarnings(): boolean {
  return warnings.length > 0;
}

function displayPath(p: string): string {
  const resolved = path.resolve(p);
  if (resolved.startsWith(HOME)) return `~${resolved.slice(HOME.length)}`;
  return resolved;
}

function sample(paths: string[]): string {
  const unique = [...new Set(paths)];
  const first = unique.slice(0, 3);
  const rest = unique.length > 3 ? `\n    (+${unique.length - 3} more)` : '';
  return first.join('\n    ') + rest;
}

function terminalName(): string {
  return process.env.TERM_PROGRAM || process.env.TERMINAL_EMULATOR || 'your terminal';
}
