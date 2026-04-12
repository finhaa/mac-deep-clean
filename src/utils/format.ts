import chalk from 'chalk';
import type { Risk } from '../types.js';

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

export function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return `${str.slice(0, max - 1)}…`;
}
