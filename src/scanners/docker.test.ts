import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/exec.js', () => ({
  commandExists: vi.fn(),
  run: vi.fn(),
}));

import { run } from '../utils/exec.js';
import { DockerScanner, reclaimableBytes } from './docker.js';

const DF = `TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE
Images          10        2         5GB       3GB (60%)
Containers      3         1         100MB     50MB (50%)
Local Volumes   4         1         20GB      15GB (75%)
Build Cache     50        0         2GB       1GB (50%)
`;

describe('reclaimableBytes', () => {
  it('leaves volumes out, since the prune never touches them', () => {
    expect(reclaimableBytes(DF)).toBe(4 * 1024 ** 3 + 50 * 1024 ** 2);
  });
});

describe('DockerScanner.clean', () => {
  it('prunes images, containers and build cache but never volumes', async () => {
    const runMock = vi.mocked(run);
    runMock.mockResolvedValue({ stdout: '', stderr: '', code: 0 });
    await new DockerScanner().clean([
      {
        path: 'docker:system',
        size: 1,
        label: 'Docker',
        category: 'docker',
        risk: 'risky',
      },
    ]);
    const commands = runMock.mock.calls.map(([command]) => command);
    expect(commands).toEqual(['docker system prune -a -f']);
  });
});
