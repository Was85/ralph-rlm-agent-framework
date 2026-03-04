# Changelog

## 3.0.0 (2026-03-02)

### Breaking Changes

- Rewritten from PowerShell to TypeScript
- Single CLI replaces three separate editions (claude-code, claude-code-teams, copilot-cli)
- PowerShell 7 no longer required — only Node.js 18+
- Companion `.ps1`/`.sh` scripts replaced by `ralph skill <name>` subcommands

### Features

- **Single binary** — `npm install -g ralph-rlm` gives you the `ralph` command
- **Multi-runner support** — `--runner claude` or `--runner copilot` via CLI flag
- **Team mode** — `--team --teammates N` for parallel agent teams
- **Scaffold command** — `ralph scaffold` sets up project files
- **Cross-platform file locking** — `proper-lockfile` replaces Windows-only named mutex
- **156 tests** — comprehensive unit and integration test suite

### Bug Fixes

- Pipeline pollution from Invoke-Claude return values (Bug 1)
- `exit` vs `return` terminating entire script (Bug 2)
- Missing mutex on Repair-FeatureStats (Bug 3)
- Stats not recalculated after increment-feature-attempts (Bug 4)
- Orphaned team files on timeout kill (Bug 5)
- Git stash exit code polluting LASTEXITCODE (Bug 6)
