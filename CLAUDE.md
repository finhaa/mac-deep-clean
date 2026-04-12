# CLAUDE.md

## Project

mac-deep-clean — macOS CLI that cleans what other cleaners miss.

## Context

This project is inspired by [clmm-clean-my-mac-cli](https://github.com/0xAstroAlpha/clmm-clean-my-mac-cli) and [mac-cleaner-cli](https://github.com/guhcostan/mac-cleaner-cli). Both are TypeScript CLIs using Commander.js + Inquirer. We borrow architectural patterns (BaseScanner, category-based cleanup, interactive selection) but add scanners for categories they completely miss.

Read `mac-deep-clean-spec.md` for the full specification including all scanner paths, architecture, commands, safety rules, and implementation order.

## Key Decisions

- TypeScript + Node.js >= 20, ESM
- Commander.js for CLI, @inquirer/prompts for interactive UI
- Each scanner is a self-contained class extending BaseScanner
- Some scanners need special cleanup commands (docker prune, xcrun simctl delete) instead of rm -rf
- Size calculations must timeout after 30s to avoid SIP-related hangs
- Use lstat not stat for symlinks
- Protected paths must be validated before any deletion
- `--dry-run` must have zero side effects

## Commands

```bash
npm run dev -- scan        # Run scan in dev mode
npm run dev -- clean       # Interactive cleanup
npm run dev -- doctor      # Full diagnostic
```

## Code Style

- Biome for lint/format
- No unnecessary comments or docstrings
- Minimal error handling — let errors propagate unless they need user-facing messages
- Prefer early returns over nested conditionals
- Use `async/await` throughout, no callbacks

## Testing

- Vitest
- Mock filesystem operations in scanner tests
- Test protected path validation thoroughly
- No need to test CLI output formatting extensively

## Credits

Include credits to clmm-clean-my-mac-cli (@0xAstroAlpha), mac-cleaner-cli (@guhcostan), and Mole (@tw93) in README.
