import path from 'node:path';
import { HOME } from './paths.js';

type WarningKind = 'fda' | 'sudo' | 'other';

interface PermissionWarning {
  kind: WarningKind;
  path: string;
  partialBytes: number;
}

const warnings: PermissionWarning[] = [];

const NOISE_THRESHOLD_BYTES = 100 * 1024 * 1024;

export function addPermissionWarning(target: string, partialBytes = 0): void {
  warnings.push({ kind: inferKind(target), path: target, partialBytes });
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

function isRunningAsRoot(): boolean {
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

export function flushWarnings(): string[] {
  const isRoot = isRunningAsRoot();

  const normalized = warnings.map((w) =>
    isRoot && w.kind === 'sudo' ? { ...w, kind: 'other' as WarningKind } : w,
  );
  warnings.length = 0;

  const fda = normalized.filter((w) => w.kind === 'fda');
  const sudo = normalized.filter((w) => w.kind === 'sudo');
  const other = normalized.filter((w) => w.kind === 'other');

  const out: string[] = [];

  if (fda.length > 0 && sumBytes(fda) >= NOISE_THRESHOLD_BYTES) {
    out.push(
      `${fda.length} path(s) under ~/Library need Full Disk Access (≥ ${formatMb(sumBytes(fda))} partially read):\n    ${sampleLines(fda)}\n    Fix: System Settings → Privacy & Security → Full Disk Access\n    → add ${terminalName()} and restart it.`,
    );
  }

  if (sudo.length > 0 && sumBytes(sudo) >= NOISE_THRESHOLD_BYTES) {
    out.push(
      `${sudo.length} system path(s) are root-owned — FDA can't fix these (≥ ${formatMb(sumBytes(sudo))} partially read):\n    ${sampleLines(sudo)}\n    Fix: npm run build && sudo node dist/index.js scan`,
    );
  }

  if (other.length > 0 && sumBytes(other) >= NOISE_THRESHOLD_BYTES) {
    const note = isRoot ? ' (running as root and still unreadable — likely SIP-protected)' : '';
    out.push(`${other.length} other path(s) were unreadable${note}:\n    ${sampleLines(other)}`);
  }

  return out;
}

export function hasWarnings(): boolean {
  return warnings.length > 0;
}

function sumBytes(list: PermissionWarning[]): number {
  return list.reduce((sum, w) => sum + w.partialBytes, 0);
}

function displayPath(p: string): string {
  const resolved = path.resolve(p);
  if (resolved.startsWith(HOME)) return `~${resolved.slice(HOME.length)}`;
  return resolved;
}

function sampleLines(list: PermissionWarning[]): string {
  const unique = [...new Set(list.map((w) => displayPath(w.path)))];
  const first = unique.slice(0, 3);
  const rest = unique.length > 3 ? `\n    (+${unique.length - 3} more)` : '';
  return first.join('\n    ') + rest;
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

function terminalName(): string {
  return process.env.TERM_PROGRAM || process.env.TERMINAL_EMULATOR || 'your terminal';
}
