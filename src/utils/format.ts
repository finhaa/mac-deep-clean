import path from 'node:path';
import chalk from 'chalk';
import type { Risk } from '../types.js';
import { HOME, isInside } from './paths.js';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** i;
  const formatted = value >= 100 ? value.toFixed(0) : value.toFixed(1);
  return `${formatted} ${UNITS[i]}`;
}

export function colorRisk(risk: Risk): string {
  switch (risk) {
    case 'safe':
      return chalk.green(risk);
    case 'moderate':
      return chalk.yellow(risk);
    case 'risky':
      return chalk.red(risk);
  }
}

export function colorSize(bytes: number): string {
  const s = formatBytes(bytes);
  if (bytes >= 10 * 1024 ** 3) return chalk.red.bold(s);
  if (bytes >= 1024 ** 3) return chalk.yellow(s);
  return chalk.white(s);
}

// File names and plist content are attacker-controlled text: a raw ESC or CR could overwrite the review line,
// and anything invisible (format characters such as bidi overrides, zero-width characters and tags, line and
// paragraph separators, default-ignorable code points) makes one name read as another.
const CONTROL_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/gu;

export function stripControl(str: string): string {
  return str.replace(CONTROL_CHARS, '?');
}

export function truncate(str: string, max: number): string {
  const clean = stripControl(str);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

/** `~/x` for a path inside HOME; a sibling such as `<HOME>ael` is not inside it and stays as it is. */
export function tildify(p: string): string {
  if (!isInside(HOME, p)) return p;
  const home = path.resolve(HOME).normalize('NFC');
  return `~${path.resolve(p).normalize('NFC').slice(home.length)}`;
}
