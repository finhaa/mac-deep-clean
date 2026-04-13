# Changelog

All notable changes to mac-deep-clean are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial 25-scanner suite covering wallpaper cache, Electron app caches,
  containers, screen recording apps, Docker, Android SDK/AVDs,
  iOS simulators + Xcode DerivedData, iOS device backups, Time Machine
  snapshots, APFS snapshots, music creation libraries, browsers, dev
  caches, Homebrew, JetBrains IDEs, Spotify, Mail Downloads, Diagnostic
  Reports, Saved Application State, temp files, Trash, orphaned
  LaunchAgents, logs, user caches, and system caches.
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

### Safety

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
