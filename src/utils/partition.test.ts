import { describe, expect, it } from 'vitest';
import type { ScannerReport } from '../types.js';
import { hasContent, partitionCleanable } from './partition.js';

const item = (path: string, size: number, cleanable?: boolean) => ({
  path,
  size,
  label: path,
  category: 'docker',
  risk: 'risky' as const,
  ...(cleanable === undefined ? {} : { cleanable }),
});

describe('partitionCleanable', () => {
  it('moves items marked cleanable:false out of the report and its total', () => {
    const report: ScannerReport = {
      name: 'Docker',
      category: 'docker',
      description: 'd',
      risk: 'risky',
      results: [item('docker:system', 100), item('/vm', 900, false), item('/explicit', 50, true)],
      totalSize: 1050,
    };
    const { reports, infoItems } = partitionCleanable([report]);
    expect(reports[0]?.results.map((r) => r.path)).toEqual(['docker:system', '/explicit']);
    expect(reports[0]?.totalSize).toBe(150);
    expect(infoItems.map((r) => r.path)).toEqual(['/vm']);
  });

  it('keeps every other field of the report', () => {
    const report: ScannerReport = {
      name: 'N',
      category: 'c',
      description: 'd',
      risk: 'safe',
      results: [],
      totalSize: 0,
      error: 'boom',
    };
    expect(partitionCleanable([report]).reports[0]).toMatchObject({ name: 'N', error: 'boom' });
  });
});

describe('hasContent', () => {
  it('is true for a sized item or a virtual item of size 0, false for nothing else', () => {
    expect(hasContent([item('/a', 10)])).toBe(true);
    expect(hasContent([{ ...item('/s', 0), virtual: true }])).toBe(true);
    expect(hasContent([item('/z', 0)])).toBe(false);
    expect(hasContent([])).toBe(false);
  });
});
