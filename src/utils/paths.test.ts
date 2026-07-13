import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSafeToDelete, isProtectedPath } from './paths.js';

describe('isProtectedPath', () => {
  it('protects /System', () => {
    expect(isProtectedPath('/System')).toBe(true);
  });

  it('protects the home dir itself', () => {
    expect(isProtectedPath(os.homedir())).toBe(true);
  });

  it('protects ~/Documents', () => {
    expect(isProtectedPath(path.join(os.homedir(), 'Documents'))).toBe(true);
  });

  it('protects ~/Library (parent dir)', () => {
    expect(isProtectedPath(path.join(os.homedir(), 'Library'))).toBe(true);
  });

  it('does not protect arbitrary cache dirs', () => {
    expect(
      isProtectedPath(path.join(os.homedir(), 'Library/Application Support/Claude/Cache')),
    ).toBe(false);
  });
});

describe('assertSafeToDelete', () => {
  it('throws for protected paths', () => {
    expect(() => assertSafeToDelete(os.homedir())).toThrow();
    expect(() => assertSafeToDelete('/System')).toThrow();
  });

  it('throws for /', () => {
    expect(() => assertSafeToDelete('/')).toThrow();
  });

  it('allows deep cache paths', () => {
    expect(() =>
      assertSafeToDelete(path.join(os.homedir(), 'Library/Application Support/Claude/Cache')),
    ).not.toThrow();
  });

  it('throws when target is an ancestor of a protected path', () => {
    expect(() => assertSafeToDelete('/private/var')).toThrow(/ancestor of protected/);
    expect(() => assertSafeToDelete(path.join(os.homedir(), 'Library'))).toThrow();
  });
});
