# mac-deep-clean

> CLI that cleans what other Mac cleaners miss — wallpaper cache, Electron app caches, Docker, screen recordings, and more.

Most Mac cleaners cover generic caches, logs, Homebrew, and Xcode. They ignore the biggest "System Data" offenders on modern macOS:

- `com.apple.wallpaper` cache (can reach **40+ GB** on Macs with dynamic wallpapers)
- Electron app caches (Claude, Cursor, VS Code, Slack, Discord, Figma, Linear, Obsidian…)
- Granular `~/Library/Containers` and `~/Library/Group Containers` caches
- Screen recording apps (Cap, Screen Studio, OBS)
- Docker prune (unused images, stopped containers, build cache; volumes are kept)
- Android SDK, emulators, AVDs
- Time Machine local snapshots
- APFS snapshots
- iOS Simulators (CoreSimulator) + Xcode DerivedData
- Music creation caches (GarageBand, Logic Pro sound libraries)

## Install

Not published to npm yet — install from source. Requires Node.js **>= 20.12.0**.

```bash
git clone https://github.com/finhaa/mac-deep-clean.git
cd mac-deep-clean
npm install
npm run build
npm link            # exposes the `mac-deep-clean` binary on your PATH
```

Or skip `npm link` and run the built binary directly with `node dist/index.js <command>`.

## Usage

```bash
mac-deep-clean scan               # Scan and show reclaimable space
mac-deep-clean scan --deep        # Also report Electron app state folders (risky)
mac-deep-clean clean              # Interactive cleanup
mac-deep-clean clean --dry-run    # Preview only, no deletions
mac-deep-clean clean --risky      # Include risky categories and items (docker, APFS snapshots; Electron state also needs --deep)
mac-deep-clean clean --yes        # Non-interactive; selects only safe items unless you add --risky or --category (see What `clean` picks below); .venv/venv always left to the picker
mac-deep-clean clean --category docker
mac-deep-clean doctor             # Full diagnostic with recommendations
mac-deep-clean purge              # Walk dev roots, delete node_modules/.venv/target/...
mac-deep-clean purge --dry-run    # Preview project artifact deletion
mac-deep-clean purge --yes        # Skip confirmation (leaves .venv/venv for the interactive picker)
mac-deep-clean purge --path ~/work ~/oss
                                  # Override the default dev search roots
mac-deep-clean purge --exclude ~/code/client-a
                                  # Skip these dirs and everything inside them
mac-deep-clean duplicates ~/Downloads --min-size 5MB
                                  # Read-only duplicate file report
```

## What `clean` picks

- `clean` scans every category except the risky ones (`docker`) and hides risky items, such as APFS
  snapshots and Electron app state. In the list only the safe items start ticked.
- `--risky` adds the risky categories and items.
- `--category <name>` scans only that category and shows every item of it, risky ones too.
- `--deep` adds Electron app state folders, which are risky: `clean` lists them only with `--risky` or
  `--category electron`, and `--yes` picks them only with `--category electron`.
- With `--yes` only safe items are picked unless you pass `--risky` or name a `--category`. `--yes --risky` adds
  the moderate and risky ones except the irreversible items, and `--yes --category <name>` picks every item of
  that category, irreversible ones too. `.venv` and `venv` folders are never picked by `--yes`, not even with
  `--category project-artifacts`.

Irreversible items cannot be undone. In the interactive list they are not marked and none of them
starts ticked, so one is cleaned only if you tick it. `--yes` picks them only when you name their
category, as in `clean --category time-machine --yes`, which then picks every item of it:

- `time-machine`: local Time Machine snapshots
- `apfs-snapshots`: APFS snapshots
- `ios-backups`: iOS device backups
- `screen-recording`: screen recording app data
- `music-creation`: GarageBand and Logic sound libraries
- `docker`: the `docker system prune`
- `ios-simulators`: Xcode Archives (DerivedData and unavailable simulators are not irreversible)
- `android`: Android virtual devices (the SDK and its caches are not)
- `electron`: Electron app state folders, listed only with `--deep`
- `jetbrains`: JetBrains caches, where LocalHistory lives (the logs are not)

## Running with sudo

A few categories need root permissions — either to measure accurately
(`/Library/Caches/*`, which is root-owned) or to actually delete
(`tmutil` snapshots, `diskutil apfs` snapshots, `/Library/*`).

Snapshot deletion needs no root process: the Time Machine and APFS scanners
run `sudo tmutil ...` and `sudo diskutil ...` for that one command and ask for
your password then. So run those without sudo:

```bash
npm run build
node dist/index.js clean --category time-machine
node dist/index.js clean --category apfs-snapshots
```

Only the root-owned `/Library` entries need the whole tool to run as root:
`system-cache` always, and the system parts of `logs`, `diagnostic-reports`,
`launch-agents` and `music-creation`. Everything else never does. Without sudo, the system parts
of `logs`, `diagnostic-reports`, `launch-agents` and `music-creation` are not listed at all, since
the run could not delete them. For example:

```bash
sudo node dist/index.js scan --category system-cache
sudo node dist/index.js clean --category system-cache --dry-run
```

Everything a root run does, it does as root: every scanner, every shell
command (`find`, `du`, `plutil`, `docker`) and every deletion, with root's
`PATH`. Keep a root run to a single `--category`, preview it with `--dry-run`
first, and never combine `sudo` with `--yes --risky`. Only Homebrew and Xcode
tooling are handed back to the invoking user (`SUDO_USER`).

Each snapshot is listed on its own, by date (Time Machine) or by name (APFS),
and only the ones you pick are deleted.
Snapshots are irreversible, so `--yes` picks them only by their own `--category` ([What `clean` picks](#what-clean-picks)).
Snapshots have no measurable size, so the list shows 0 B. APFS snapshots are `risky`: they appear only with
`--category apfs-snapshots` or `--risky`, and the OS update and Time Machine
snapshots are never offered there.

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
(`Cache`, `CachedData`, `CachedExtensionVSIXs`, `Code Cache`, `GPUCache`,
`Service Worker/CacheStorage`, `blob_storage`, `logs`).
Non-cache data — IndexedDB, Local Storage, `workspaceStorage`, history,
sessions — is excluded because deleting it **loses conversations, workspaces,
and extension state**.

Pass `--deep` to additionally report the big state folders of each app, one
entry per folder (for example `IndexedDB`, `vm_bundles`, `User/workspaceStorage`),
marked `risky`. Because they are risky, `clean` lists them only with `--risky` or
`--category electron`, and `--yes` picks them only with `--category electron`.
On a real Mac that's typically 10+ GB of Claude conversations,
Cursor workspace storage, VS Code extensions, etc. The app folder itself and
settings files (`settings.json`, `keybindings.json`, snippets, MCP config) are
never listed. Review carefully; export anything you care about before cleaning.

## Scanners

| Scanner               | Category             | Risk     |
| --------------------- | -------------------- | -------- |
| Wallpaper Cache       | `wallpaper`          | safe     |
| Electron Apps         | `electron`           | safe     |
| Containers            | `containers`         | moderate |
| Screen Recording      | `screen-recording`   | moderate |
| Docker                | `docker`             | risky    |
| Android SDK           | `android`            | moderate |
| iOS Simulators & Xcode | `ios-simulators`    | safe     |
| iOS Device Backups    | `ios-backups`        | moderate |
| Time Machine Local Snapshots | `time-machine` | moderate |
| APFS Snapshots        | `apfs-snapshots`     | moderate |
| Music Creation        | `music-creation`     | moderate |
| Browser Caches        | `browser-cache`      | safe     |
| Developer Caches      | `dev-cache`          | safe     |
| Homebrew              | `homebrew`           | safe     |
| JetBrains IDEs        | `jetbrains`          | moderate |
| Spotify               | `spotify`            | safe     |
| Mail Downloads        | `mail-downloads`     | moderate |
| Diagnostic Reports    | `diagnostic-reports` | safe     |
| Saved Application State | `saved-app-state`  | safe     |
| Temp Files            | `temp-files`         | moderate |
| Trash                 | `trash`              | moderate |
| Orphaned LaunchAgents | `launch-agents`      | moderate |
| Logs                  | `logs`               | safe     |
| User Caches           | `user-cache`         | safe     |
| System Caches         | `system-cache`       | moderate |
| Project Build Artifacts | `project-artifacts` | moderate |
| Git Leaked Pack Files | `git-tmp-packs` | moderate |

The `project-artifacts` scanner backs the dedicated `purge` command, but is
also a normal category — `scan`/`clean --category project-artifacts` work too.

The `git-tmp-packs` scanner looks for `tmp_pack_*` files (10 MB or more) in
`.git/objects/pack` of repos under the same project roots. Git leaves one behind
when a fetch is interrupted. Only files untouched for 10 minutes are listed, and
the age is checked again right before deleting. It never runs `git`, and it is
moderate risk, so `clean --yes` skips it; pick it in the list or use
`--category git-tmp-packs`.

Plus two extra commands:

- **`purge`** — walks `~/code`, `~/Projects`, `~/dev`, etc. and finds
  `node_modules`, `.venv`, `target`, `Pods`, `.next`, `.terraform`,
  and friends. Dedupes by realpath so case-insensitive APFS doesn't
  double-count.
  `--path` refuses your home folder, system folders and installed-software
  folders such as `/Applications` and `~/Library`.
- **`duplicates <path>`** — read-only sha256 duplicate file detector,
  scoped to a path you specify. Two-stage (size collision → hash) to
  keep it fast.

## Safety

- Protected paths (`/System`, `~/Documents`, `~/Desktop`, `~/Downloads`, `~/.ssh`, …) are never touched, nor is any directory that _contains_ one of them.
- Risky items are excluded from cleanup unless you pass `--risky` or name their `--category`, and `--yes` picks an irreversible item only when you name its `--category` ([the full list](#what-clean-picks)).
- `--dry-run` is 100% side-effect-free.
- Docker uses `docker system prune`, not manual `rm`.
- iOS simulators use `xcrun simctl delete`, not manual `rm`.
- Size calculations timeout after 30s to avoid hangs on SIP-protected dirs.
- Time Machine and APFS snapshot deletion runs `sudo tmutil` or `sudo diskutil` for that one command, which asks for your password.

## Credits

Inspired by and borrowing architectural patterns from:

- [clmm-clean-my-mac-cli](https://github.com/0xAstroAlpha/clmm-clean-my-mac-cli) by [@0xAstroAlpha](https://github.com/0xAstroAlpha)
- [mac-cleaner-cli](https://github.com/guhcostan/mac-cleaner-cli) by [@guhcostan](https://github.com/guhcostan)
- [Mole](https://github.com/tw93/Mole) by [@tw93](https://github.com/tw93)

## License

MIT
