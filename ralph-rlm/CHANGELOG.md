# Changelog

## 4.0.0 (2026-03-29)

### Breaking Changes

- Ralph is now a framework-owned `planner -> implementer -> verifier` harness instead of the older chat-owned loop
- Feature completion now requires real per-feature artifacts, a real feature commit, and post-merge verification
- Team mode now uses worktree isolation and merges back into the branch Ralph was started from
- Story generation is stricter: weak or oversized features are rejected earlier by framework quality gates
- Runtime state is now durable under `.ralph/runtime/`, enabling resumable runs from repo state alone

### Added

- Full feature artifact chain under `.ralph/features/<id>/`
- Durable runtime session and per-feature recovery state
- Smoke-proven sequential and team support for both Claude and Copilot
- Reproducible todo CRUD smoke fixtures and wrapper scripts

### Changed

- `scaffold`, `init`, `validate`, `optimize`, `run`, and `status` now align with the new harness workflow
- Prompts are materialized into the project so both Claude and Copilot can run from project-local files
- Documentation now explains the beginner path separately from the power-user phase controls

## 3.2.1 (2026-03-09)

### Fixed

- **Verification never blocks features** — `verifyPreviousFeature` now checks `max_attempts_per_feature` after incrementing attempts, matching team-orchestrator behavior; previously verification failures looped until the 50-iteration hard cap
- **Verification fails after agent tests pass** — added 3-second delay before verification to let file locks release (Windows dotnet/MSBuild), and increased verification timeout from 120s to 300s

## 3.2.0 (2026-03-07)

### Security

- **Shell injection prevention** — all git commands use `execFile` (no shell interpolation); CLI arguments are shell-escaped via `shellEscape()` on both Unix and Windows
- **Safe command execution** — new `gitExec()` and `safeExecCommand()` utilities replace raw `exec()` calls throughout the codebase
- **Commit message sanitization** — strips backticks, `$`, control chars, and limits length to prevent injection via AI-generated messages

### Added

- **Atomic file writes** — feature_list.json and validation-state.json writes use temp file + `rename()` to prevent corruption on crash
- **File locking** — concurrent feature_list.json access uses file-based locks with stale detection (30s) and process exit cleanup
- **Schema validation** — feature_list.json structure validated on every read to catch corruption early
- **Agent timeout** — configurable timeout with SIGTERM → SIGKILL (5s grace) prevents hung agents
- **Graceful shutdown** — SIGINT/SIGTERM handlers clean up git worktrees before exit
- **Rebase-before-merge** — worktree branches rebased onto HEAD before merging to reduce conflicts
- **Conflict serialization** — features conflicting 2+ times in parallel are dispatched solo next iteration
- **Dependency-aware scheduling** — team mode groups features by dependency level for parallel execution
- **Pre-merge cleanup** — `ensureCleanWorkingTree()` stashes or resets dirty state before each merge
- **Framework file tracking** — `.ralph/` and `.claude/` committed before worktree creation to prevent merge errors

### Fixed

- **Team mode merge failures** — untracked `.ralph/prompts/` files blocked all worktree merges
- **Cascading merge failures** — failed merge abort left unmerged state blocking subsequent merges; now cleaned with `reset --hard` fallback
- **Dirty working tree blocking merges** — vitest cache files stashed before next merge
- **Init safety net** — re-running init resets features to pending and undoes code changes
- **Git stash preserves prompts** — stash excludes `.ralph/` directory during phase transitions
- **Preflight checks** — runner detection uses `execFile` instead of shell `which`/`where`

### Changed

- **Team mode architecture** — rewrote from claimed_by coordination to git worktree isolation with auto-merge and verification
- **Locked updates** — `lockedUpdate()` pattern for all concurrent feature_list.json mutations
- **Targeted git add** — team orchestrator commits only framework files instead of `git add .`
- **315 tests** — up from 156, covering all new security and team mode features

## 3.1.0 (2026-03-05)

### Added

- End-to-end and unit tests for CLI commands and configuration handling
- Mock `checkCli` in unit tests to avoid dependency on actual CLI binary

### Fixed

- Repository URLs updated to reflect correct GitHub account

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
