import path from 'node:path';
import type { ScanResult } from '../types.js';
import { getSize, pathExists } from '../utils/fs.js';
import { HOME } from '../utils/paths.js';
import { BaseScanner } from './base-scanner.js';

export class DevCacheScanner extends BaseScanner {
  readonly name = 'Developer Caches';
  readonly category = 'dev-cache';
  readonly description = 'pnpm store, npm cache, yarn cache, cargo, go, etc.';
  readonly risk = 'safe' as const;

  async scan(): Promise<ScanResult[]> {
    const targets: Array<{ rel: string; label: string; risk?: 'safe' | 'moderate' }> = [
      { rel: 'Library/pnpm/store', label: 'pnpm store' },
      { rel: '.pnpm-store', label: 'pnpm store (legacy)' },
      { rel: '.npm/_cacache', label: 'npm cache' },
      { rel: 'Library/Caches/Yarn', label: 'Yarn cache' },
      { rel: '.cache/yarn', label: 'Yarn cache (xdg)' },
      { rel: '.cargo/registry/cache', label: 'Cargo registry cache' },
      { rel: '.cargo/registry/src', label: 'Cargo registry src' },
      { rel: 'go/pkg/mod/cache', label: 'Go module cache' },
      { rel: 'Library/Caches/Homebrew/go_cache', label: 'Go build cache' },
      { rel: '.gradle/caches', label: 'Gradle caches' },
      { rel: '.m2/repository', label: 'Maven repository', risk: 'moderate' },
      { rel: 'Library/Caches/pip', label: 'pip cache' },
      { rel: 'Library/Caches/pypoetry', label: 'Poetry cache' },
      { rel: 'Library/Caches/uv', label: 'uv cache' },
      { rel: '.bun/install/cache', label: 'Bun cache' },
      { rel: 'Library/Caches/deno', label: 'Deno cache' },
      { rel: 'Library/Caches/CocoaPods', label: 'CocoaPods cache' },
      { rel: '.cocoapods/repos', label: 'CocoaPods repos', risk: 'moderate' },
      { rel: 'Library/Caches/pre-commit', label: 'pre-commit cache' },
      { rel: 'Library/Caches/Composer', label: 'Composer cache' },
      { rel: 'Library/Caches/Bazel', label: 'Bazel cache' },
      { rel: '.terraform.d/plugin-cache', label: 'Terraform plugin cache' },
    ];

    const results: ScanResult[] = [];
    for (const t of targets) {
      const target = path.join(HOME, t.rel);
      if (!(await pathExists(target))) continue;
      const size = await getSize(target);
      if (size < 10 * 1024 * 1024) continue;
      results.push({
        path: target,
        size,
        label: t.label,
        category: this.category,
        risk: t.risk ?? 'safe',
        description: t.label,
      });
    }
    return results;
  }
}
