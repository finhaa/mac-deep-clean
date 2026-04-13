# mac-deep-clean

> CLI that cleans what other Mac cleaners miss — wallpaper cache, Electron app caches, Docker, screen recordings, and more.

Most Mac cleaners cover generic caches, logs, Homebrew, and Xcode. They ignore the biggest "System Data" offenders on modern macOS:

- `com.apple.wallpaper` cache (can reach **40+ GB** on Macs with dynamic wallpapers)
- Electron app caches (Claude, Cursor, VS Code, Slack, Discord, Figma, Linear, Obsidian…)
- Granular `~/Library/Containers` and `~/Library/Group Containers` caches
- Screen recording apps (Cap, Screen Studio, OBS)
- Docker full prune (images, containers, volumes, build cache)
- Android SDK, emulators, AVDs
- Time Machine local snapshots
- APFS snapshots
- iOS Simulators (CoreSimulator) + Xcode DerivedData
- Music creation caches (GarageBand, Logic Pro sound libraries)

## Install

```bash
npx mac-deep-clean scan
# or install globally
npm i -g mac-deep-clean
```

## Usage

```bash
mac-deep-clean scan               # Scan and show reclaimable space
mac-deep-clean scan --deep        # Also report Electron app full state (risky)
mac-deep-clean clean              # Interactive cleanup
mac-deep-clean clean --dry-run    # Preview only, no deletions
mac-deep-clean clean --risky      # Include risky categories (docker)
mac-deep-clean clean --category docker
mac-deep-clean doctor             # Full diagnostic with recommendations
```

## Running with sudo

A few categories need root permissions — either to measure accurately
(`/Library/Caches/*`, which is root-owned) or to actually delete
(`tmutil` snapshots, `diskutil apfs` snapshots, `/Library/*`).

Preferred flow:

```bash
npm run build
sudo node dist/index.js scan
sudo node dist/index.js clean --category time-machine
sudo node dist/index.js clean --category apfs-snapshots
```

**Avoid** `sudo npm run dev` — that runs npm itself as root and will
leave root-owned files in your `node_modules` and `.npm` cache.
`sudo node dist/index.js` invokes the built binary directly, bypassing
npm and tsx entirely, which is what you want.

When running as root, mac-deep-clean automatically detects it and
changes the permission-warning output accordingly: any `/Library`
path that still fails is treated as likely SIP-protected instead of
telling you to "re-run with sudo" (you already are).

## Why my numbers look low (Full Disk Access)

macOS's TCC (Transparency, Consent and Control) blocks unprivileged processes
from reading parts of `~/Library` — even for files owned by your own user.
When `du` can't traverse a dir, it silently reports the partial size, which
means mac-deep-clean will understate the numbers compared to `sudo du`.

If your scan shows a warning like `Some paths were unreadable (macOS TCC)`,
grant Full Disk Access to the terminal running the command:

1. Open **System Settings → Privacy & Security → Full Disk Access**
2. Click **+** and add your terminal app (Terminal.app, iTerm2, Ghostty, etc.)
   — or the Node binary if you run via a launcher
3. Restart the terminal and re-run `mac-deep-clean scan`

After granting access the wallpaper cache, Electron state, and Containers
sizes should match `sudo du` reports.

### --deep mode (Electron apps)

By default, the Electron scanner only reports _regenerable cache subdirs_
(`Cache`, `Code Cache`, `GPUCache`, `blob_storage`, `Service Worker`, `logs`).
Non-cache data — IndexedDB, Local Storage, `workspaceStorage`, history,
sessions — is excluded because deleting it **loses conversations, workspaces,
and extension state**.

Pass `--deep` to additionally report a per-app "full app data (state)" entry
marked `risky`. On a real Mac that's typically 10+ GB of Claude conversations,
Cursor workspace storage, VS Code extensions, etc. Review carefully; export
anything you care about before cleaning.

## Scanners

| Scanner          | Category           | Risk     |
| ---------------- | ------------------ | -------- |
| Wallpaper Cache  | `wallpaper`        | safe     |
| Electron Apps    | `electron`         | safe     |
| Containers       | `containers`       | moderate |
| Screen Recording | `screen-recording` | moderate |
| Docker           | `docker`           | risky    |
| Android SDK      | `android`          | moderate |
| iOS Simulators   | `ios-simulators`   | safe     |
| Time Machine     | `time-machine`     | moderate |
| APFS Snapshots   | `apfs-snapshots`   | moderate |
| Music Creation   | `music-creation`   | moderate |
| Browser Caches   | `browser-cache`    | safe     |
| Developer Caches | `dev-cache`        | safe     |
| Homebrew         | `homebrew`         | safe     |
| Logs             | `logs`             | safe     |
| User Caches      | `user-cache`       | safe     |
| System Caches    | `system-cache`     | moderate |

## Safety

- Protected paths (`/System`, `~/Documents`, `~/Desktop`, `~/Downloads`, `~/.ssh`, …) are never touched.
- `--dry-run` is 100% side-effect-free.
- Docker uses `docker system prune`, not manual `rm`.
- iOS simulators use `xcrun simctl delete`, not manual `rm`.
- Size calculations timeout after 30s to avoid hangs on SIP-protected dirs.
- Time Machine and APFS snapshot deletion requires `sudo` and is clearly warned.

## Credits

Inspired by and borrowing architectural patterns from:

- [clmm-clean-my-mac-cli](https://github.com/0xAstroAlpha/clmm-clean-my-mac-cli) by [@0xAstroAlpha](https://github.com/0xAstroAlpha)
- [mac-cleaner-cli](https://github.com/guhcostan/mac-cleaner-cli) by [@guhcostan](https://github.com/guhcostan)
- [Mole](https://github.com/tw93/Mole) by [@tw93](https://github.com/tw93)

## License

MIT
