import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { purgeRootProblem } from './project-artifacts.js';

const home = os.homedir();

describe('purgeRootProblem', () => {
  it.each([
    home,
    '/',
    '/Users',
    '/Applications',
    '/Applications/Foo.app/Contents/Resources',
    '/usr/local',
    '/opt',
    '/opt/homebrew',
    '/Library',
    '/private/var',
    path.join(home, 'Library'),
    path.join(home, 'Library/Application Support/Code'),
    path.join(home, 'Documents'),
    path.join(home, 'Documents/proj'),
    path.join(home, '.ssh'),
  ])('refuses %s as a search root', (root) => {
    expect(purgeRootProblem(root)).toEqual(expect.any(String));
  });

  it.each([
    path.join(home, 'code'),
    path.join(home, 'code/proj'),
    path.join(home, 'Projects'),
    '/Volumes/External/code',
    '/tmp/mdc-fine',
  ])('accepts %s', (root) => {
    expect(purgeRootProblem(root)).toBeNull();
  });
});
