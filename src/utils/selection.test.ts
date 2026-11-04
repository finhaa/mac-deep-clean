import { describe, expect, it } from 'vitest';
import type { Risk, ScanResult, ScannerReport } from '../types.js';
import { autoSelect } from './selection.js';

const item = (path: string, risk: Risk): ScanResult => ({
  path,
  size: 1,
  label: path,
  category: 'c',
  risk,
});

const report = (results: ScanResult[]): ScannerReport => ({
  name: 'c',
  category: 'c',
  description: '',
  risk: 'safe',
  results,
  totalSize: 0,
});

const reports = [
  report([item('safe', 'safe'), item('moderate', 'moderate')]),
  report([item('risky', 'risky')]),
];

describe('autoSelect', () => {
  it('selects only safe items when nothing opts into more', () => {
    expect(autoSelect(reports, false).map((r) => r.path)).toEqual(['safe']);
  });

  it('selects every risk level when the caller opted in', () => {
    expect(autoSelect(reports, true).map((r) => r.path)).toEqual(['safe', 'moderate', 'risky']);
  });

  it('leaves virtualenvs to a manual pick even when every risk level is opted in', () => {
    const artifacts = report([
      { ...item('/p/node_modules', 'moderate'), category: 'project-artifacts' },
      { ...item('/p/.venv', 'moderate'), category: 'project-artifacts' },
      { ...item('/p/venv', 'moderate'), category: 'project-artifacts' },
      { ...item('/q/venv', 'moderate'), category: 'other' },
    ]);
    expect(autoSelect([artifacts], true).map((r) => r.path)).toEqual([
      '/p/node_modules',
      '/q/venv',
    ]);
  });
});
