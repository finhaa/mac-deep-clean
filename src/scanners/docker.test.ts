import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/exec.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/exec.js')>()),
  commandExists: vi.fn(),
  run: vi.fn(),
}));

import { commandExists, run } from '../utils/exec.js';
import { DockerScanner, reclaimableBytes } from './docker.js';

const DF = `TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE
Images          10        2         5GB       3GB (60%)
Containers      3         1         100MB     50MB (50%)
Local Volumes   4         1         20GB      15GB (75%)
Build Cache     50        0         2GB       1GB (50%)
`;

beforeEach(() => {
  vi.mocked(run).mockReset();
});

// Real `docker system df` output from Docker Desktop: the build cache row has no percentage.
const REAL_DF = `TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE
Images          1         1         298MB     0B (0%)
Containers      1         1         0B        0B
Local Volumes   2         2         0B        0B
Build Cache     162       0         7.864GB   7.864GB
`;

describe('reclaimableBytes', () => {
  it('counts a row whose reclaimable size has no percentage, like the real build cache row', () => {
    expect(reclaimableBytes(REAL_DF)).toBe(Math.round(7.864 * 1024 ** 3));
  });

  it('reads the reclaimable column of the tab format used by the scan', () => {
    const tabs = 'Images\t5GB\t3GB (60%)\nBuild Cache\t2GB\t1GB\nLocal Volumes\t20GB\t15GB (75%)';
    expect(reclaimableBytes(tabs)).toBe(4 * 1024 ** 3);
  });

  it('is zero when nothing is reclaimable', () => {
    expect(reclaimableBytes('Images\t298MB\t0B (0%)\nContainers\t0B\t0B')).toBe(0);
  });

  it('leaves volumes out, since the prune never touches them', () => {
    expect(reclaimableBytes(DF)).toBe(4 * 1024 ** 3 + 50 * 1024 ** 2);
  });
});

describe('DockerScanner.scan', () => {
  it('asks docker for its numbers once and reports the reclaimable total', async () => {
    vi.mocked(commandExists).mockResolvedValue(true);
    const runMock = vi.mocked(run);
    runMock.mockReset();
    runMock.mockResolvedValue({
      stdout:
        'Images\t298MB\t0B (0%)\nBuild Cache\t7.864GB\t7.864GB\nLocal Volumes\t5GB\t5GB (100%)\n',
      stderr: '',
      code: 0,
    });

    const results = await new DockerScanner().scan();

    const dfCalls = runMock.mock.calls.filter(([command]) =>
      command.startsWith('docker system df'),
    );
    expect(dfCalls).toHaveLength(1);
    const system = results.find((r) => r.path === 'docker:system');
    expect(system?.size).toBe(Math.round(7.864 * 1024 ** 3));
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
