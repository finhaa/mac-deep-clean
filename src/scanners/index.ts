import { AndroidScanner } from './android.js';
import { ApfsSnapshotsScanner } from './apfs-snapshots.js';
import type { BaseScanner } from './base-scanner.js';
import { BrowserCacheScanner } from './browser-cache.js';
import { ContainersScanner } from './containers.js';
import { DevCacheScanner } from './dev-cache.js';
import { DockerScanner } from './docker.js';
import { ElectronAppsScanner } from './electron-apps.js';
import { HomebrewScanner } from './homebrew.js';
import { IosSimulatorsScanner } from './ios-simulators.js';
import { LogsScanner } from './logs.js';
import { MusicCreationScanner } from './music-creation.js';
import { ScreenRecordingScanner } from './screen-recording.js';
import { SystemCacheScanner } from './system-cache.js';
import { TimeMachineScanner } from './time-machine.js';
import { UserCacheScanner } from './user-cache.js';
import { WallpaperCacheScanner } from './wallpaper-cache.js';

export function getAllScanners(): BaseScanner[] {
  return [
    new WallpaperCacheScanner(),
    new ElectronAppsScanner(),
    new ContainersScanner(),
    new ScreenRecordingScanner(),
    new DockerScanner(),
    new AndroidScanner(),
    new IosSimulatorsScanner(),
    new TimeMachineScanner(),
    new ApfsSnapshotsScanner(),
    new MusicCreationScanner(),
    new BrowserCacheScanner(),
    new DevCacheScanner(),
    new HomebrewScanner(),
    new LogsScanner(),
    new UserCacheScanner(),
    new SystemCacheScanner(),
  ];
}

export type { BaseScanner };
