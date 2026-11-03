# Changelog

All notable changes to mac-deep-clean are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial 26-scanner suite covering wallpaper cache, Electron app caches,
  containers, screen recording apps, Docker, Android SDK/AVDs,
  iOS simulators + Xcode DerivedData, iOS device backups, Time Machine
  snapshots, APFS snapshots, music creation libraries, browsers, dev
  caches, Homebrew, JetBrains IDEs, Spotify, Mail Downloads, Diagnostic
  Reports, Saved Application State, temp files, Trash, orphaned
  LaunchAgents, logs, user caches, system caches, and project build
  artifacts.
- `purge` command that walks developer project roots
  (`~/code`, `~/Projects`, `~/dev`, …) and removes build artifact dirs
  (`node_modules`, `.venv`, `target`, `Pods`, `.next`, `.terraform`,
  `.gradle`, `__pycache__`, …). Dedupes by realpath.
- `duplicates <path>` command — read-only sha256 duplicate file detector
  with two-stage (size → hash) matching, `--min-size` and `--top` flags.
- `scan`, `clean`, and `doctor` commands with interactive checkbox selection
  via `@inquirer/prompts`.
- Flags: `--dry-run`, `--risky`, `--yes`, `--category <name>`, `--deep`.
- `--deep` mode for the Electron scanner reports per-app full state
  (conversations, workspace storage, extensions) as risky, separate from the
  safe cache subdirs.
- Categorized permission warnings distinguishing paths that need
  Full Disk Access (`~/Library`) from paths that need sudo (`/Library`,
  `/private`) and reporting which specific paths failed.
- Noise filter: permission warnings are suppressed when the partially-read
  size is under 100 MB so small `/Library/Caches/*` noise does not distract
  from real issues.
- Root detection: when already running under sudo, the "needs sudo" bucket
  is re-classified as "other / likely SIP-protected" to avoid nonsensical
  advice.
- CI workflow on `macos-latest` running lint, typecheck, test, and build
  on push and pull request.

### Fixed

- `clean --deep` no longer deletes risky Electron app state (conversations,
  workspaces) without `--risky`. Risk is now gated per item, including in
  `--yes` mode, matching the documented behavior.
- Temp Files cleanup now runs `assertSafeToDelete` before shelling out to
  `find`, and no longer reports space as freed when `find` fails.
- Time Machine cleanup no longer reports success when every snapshot
  deletion fails.
- The protected-path guard now protects whole subtrees for `/System`, `/usr`,
  `~/Documents`, `~/Desktop`, `~/Downloads`, `~/Pictures`, `~/Music`,
  `~/Movies`, `~/.ssh`, `~/.gnupg`, `~/Library/Keychains` and
  `~/Library/Preferences` (also for other users' home folders), matched
  case-insensitively. It used to match only the folder itself, so
  `~/.ssh/id_rsa` was deletable. `purge` no longer offers artifacts inside
  those folders. Cache container folders such as `~/Library/Caches` stay
  exact-match so their children remain cleanable.
- Emptying the Trash no longer ignores files it cannot delete: each failure is
  reported and "freed" is the measured drop in size, not the planned size.
- `purge --path` refuses roots that are protected, contain a protected path, or
  sit inside `/Applications`, `/Library`, `/opt` or `~/Library`, so `--path ~`
  can no longer offer `~/.gradle` or an app bundle's `node_modules`.
- Logs and Diagnostic Reports no longer delete the folders themselves (the
  `rmdir /Library/Logs` and `~/Library/Logs` permission errors) and Logs no
  longer counts or removes the folders that Diagnostic Reports and JetBrains
  report on their own, so no space is counted or deleted twice.
- `doctor` no longer counts the Docker Desktop VM disk (or any item this tool
  cannot clean) in its recommendations and total; it lists those separately.
- Added tests for the folder-based scanners (Android, browsers, containers,
  developer caches, iOS backups, JetBrains, Mail, saved state, screen
  recording, user caches), Homebrew, iOS simulators, Docker, `exec`, `fs`,
  warnings and report partitioning, each proved by mutation.

### Safety

- `assertSafeToDelete` now also rejects any target that is an ancestor of a
  protected path (e.g. deleting `/private/var` would remove `/private/var/db`).
- `PROTECTED_PATHS` prevents deletion of home, Documents, Desktop, Downloads,
  Pictures, Music, Movies, .ssh, .gnupg, and system directories.
- `assertSafeToDelete` rejects `/` and any near-root path.
- Docker cleanup uses `docker system prune -a --volumes` (never manual `rm`).
- iOS simulator cleanup uses `xcrun simctl delete unavailable`.
- Time Machine and APFS snapshot deletion shell out to the official
  `tmutil` / `diskutil` commands with sudo.
- `du -sk` is called with a 30 s timeout to prevent hangs on
  SIP-protected directories.
- `--dry-run` is strictly side-effect-free.
