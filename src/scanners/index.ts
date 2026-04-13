import { AndroidScanner } from './android.js';
import { ApfsSnapshotsScanner } from './apfs-snapshots.js';
import type { BaseScanner } from './base-scanner.js';
import { BrowserCacheScanner } from './browser-cache.js';
import { ContainersScanner } from './containers.js';
import { DevCacheScanner } from './dev-cache.js';
import { DiagnosticReportsScanner } from './diagnostic-reports.js';
import { DockerScanner } from './docker.js';
import { ElectronAppsScanner } from './electron-apps.js';
import { HomebrewScanner } from './homebrew.js';
import { IosBackupsScanner } from './ios-backups.js';
import { IosSimulatorsScanner } from './ios-simulators.js';
import { JetBrainsScanner } from './jetbrains.js';
import { LaunchAgentsScanner } from './launch-agents.js';
import { LogsScanner } from './logs.js';
import { MailDownloadsScanner } from './mail-downloads.js';
import { MusicCreationScanner } from './music-creation.js';
import { SavedAppStateScanner } from './saved-app-state.js';
import { ScreenRecordingScanner } from './screen-recording.js';
import { SpotifyScanner } from './spotify.js';
import { SystemCacheScanner } from './system-cache.js';
import { TempFilesScanner } from './temp-files.js';
import { TimeMachineScanner } from './time-machine.js';
import { TrashScanner } from './trash.js';
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
    new IosBackupsScanner(),
    new TimeMachineScanner(),
    new ApfsSnapshotsScanner(),
    new MusicCreationScanner(),
    new BrowserCacheScanner(),
    new DevCacheScanner(),
    new HomebrewScanner(),
    new JetBrainsScanner(),
    new SpotifyScanner(),
    new MailDownloadsScanner(),
    new DiagnosticReportsScanner(),
    new SavedAppStateScanner(),
    new TempFilesScanner(),
    new TrashScanner(),
    new LaunchAgentsScanner(),
    new LogsScanner(),
    new UserCacheScanner(),
    new SystemCacheScanner(),
  ];
}

export type { BaseScanner };
