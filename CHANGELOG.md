# Changelog

All notable changes to mac-deep-clean are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial 27-scanner suite covering wallpaper cache, Electron app caches,
  containers, screen recording apps, Docker, Android SDK/AVDs,
  iOS simulators + Xcode DerivedData, iOS device backups, Time Machine
  snapshots, APFS snapshots, music creation libraries, browsers, dev
  caches, Homebrew, JetBrains IDEs, Spotify, Mail Downloads, Diagnostic
  Reports, Saved Application State, temp files, Trash, orphaned
  LaunchAgents, logs, user caches, system caches, project build
  artifacts, and leaked `tmp_pack_*` git files.
- `purge --exclude <path>` keeps the given dirs (and anything inside them) out of
  the purge, and `purge` never offers the `node_modules` of the running tool.
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
- CI workflow on `ubuntu-latest` running lint, typecheck, test, and build
  on push and pull request.

### Fixed

- Bidi overrides, zero-width characters and the byte order mark in file names now show as `?`
  like other control characters, so a name cannot read as another one. `purge --path` also
  strips control characters from the reason it refuses a folder and from a path that is not a
  directory.
- `clean --deep` no longer deletes risky Electron app state (conversations,
  workspaces) without `--risky` or `--category electron`. Risk is now gated per item,
  including in `--yes` mode, matching the documented behavior.
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
- Which items `clean --yes` never picks is now a flag on the item (`irreversible`)
  set by the scanner, not a list of five names. JetBrains caches (local history),
  Xcode Archives, Android AVD images, `docker system prune` and the Electron
  `--deep` state items carry it too, so `--yes --risky` skips them unless their own `--category` is given.
- `doctor` measures free space against used plus free, so a nearly full volume no
  longer reads as having plenty of room because of the APFS container size.
- `purge` deletes through the same guarded `safeRemove` as every scanner, and
  `purge --path` is checked both as spelled and after resolving symlinks.
- The protected list now also covers `~/Library/Mobile Documents`, `~/Library/Mail`,
  `~/Library/Messages`, `/etc`, `/private/etc`, `/Applications`, another user's home
  folder itself and the real path of `HOME`.
- A scanner error is stripped of terminal control characters before it reaches the
  spinner, like every other label.
- `~` display shortening strips the resolved home, so a home with a trailing slash no
  longer prints `~proj/one.bin`, and `purge` labels a result outside the home with its
  own path instead of `~/../..`.
- Every path list built from the home folder now covers each spelling of it and its
  real path: `purge --path` refuses `~/Library` reached through a symlinked home, and
  permission warnings classify it as Full Disk Access. Paths are compared in one Unicode
  form, so a decomposed (NFD) spelling of a protected folder is protected too.
- A disk that is gone can leave a symlink in `/Volumes`: Orphaned LaunchAgents now treat
  it as an unmounted volume, not as a missing program, and so does a program reached
  through any other symlink that no longer resolves.
- Temp files check `TMPDIR` after normalising it, so a `/tmp/../x` spelling no longer
  passes for a folder inside `/tmp`.
- Paths under `HOME` print as `~/...` only when they really are inside it, and
  permission warnings are classified by whole folders, not by a shared name prefix.
- `clean` no longer tells you to add flags you already passed when it skips an item.
- The project scan keeps a result only when it lies inside its search root, using the
  same case-insensitive containment check as the protected list.
- Test runs refuse the Node file calls that delete, move, overwrite or truncate
  outside the temp dir: `rm`, `rmdir`, `unlink`, `rename`, `truncate`, `cp`,
  `copyFile`, `writeFile` and `appendFile`, in promise, callback and sync form,
  through named imports, `file:` URLs, Buffers, a symlinked parent, a trailing slash
  and a symlink the call follows. The temp dir itself is refused when it is `/` or
  holds the home folder. Child processes (`rm`, `find -delete`) and calls that open
  a file for writing by descriptor are not covered.
- The test that no two scanners offer the same path now runs in a temp home folder,
  fails when a scanner that should find something offers nothing, and pins which
  scanners may flag an item irreversible. `clean --help` says `--deep` with `--yes`
  also needs `--category electron`, and Music Creation items no longer say they are
  all re-downloadable. Mail Downloads, Trash, the Maven repository and CocoaPods repos
  stay `moderate` on purpose.
- `npm run format` now covers the same files as `npm run lint`, including the
  Vitest config and setup files. Tests pin where the tool looks for its own
  `node_modules`, that explicit search roots are listed once and that a dry run of
  `purge` warns about a path that resolves to a protected one.
- Added tests that pin the production defaults every other test overrides, the risk
  tier of every scanner, the exact deletion targets of the browser, wallpaper,
  developer cache, music and Electron scanners, the symlinked `--exclude` and target
  cases of `purge`, and that no two scanners offer the same or a nested path.
- Added tests for the folder-based scanners (Android, browsers, containers,
  developer caches, iOS backups, JetBrains, Mail, saved state, screen
  recording, user caches), Homebrew, iOS simulators, Docker, `exec`, `fs`,
  warnings and report partitioning.
- Added tests for the interactive paths of `clean` and `purge` (pre-ticked
  items, confirmation defaulting to no, dry run, declined and empty picks),
  `scan`, `duplicates` and the command line wiring.
- Added tests for the orphaned LaunchAgents, System Caches, Trash and Temp
  Files scans, the project-artifacts worktree and project-file filters, and
  the git tmp_pack protected-path guard.

### Safety

- `assertSafeToDelete` now also rejects any target that is an ancestor of a
  protected path (e.g. deleting `/private/var` would remove `/private/var/db`).
- `PROTECTED_PATHS` prevents deletion of home, Documents, Desktop, Downloads,
  Pictures, Music, Movies, .ssh, .gnupg, and system directories.
- `assertSafeToDelete` rejects `/` and any near-root path.
- Docker cleanup uses `docker system prune -a -f` (never manual `rm`); volumes are kept.
- iOS simulator cleanup uses `xcrun simctl delete unavailable`.
- Time Machine and APFS snapshot deletion shell out to the official
  `tmutil` / `diskutil` commands with sudo.
- `du -sk` is called with a 30 s timeout to prevent hangs on
  SIP-protected directories.
- `--dry-run` is strictly side-effect-free.
