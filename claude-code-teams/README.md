# Ralph-RLM-Framework v2.0 Teams Edition

Parallel implementation variant of the Ralph Loop Framework using Claude Code **agent teams**.

> Based on Geoffrey Huntley's [Ralph Wiggum technique](https://ghuntley.com/ralph/)

---

## What's Different from `claude-code/`?

| Aspect | `claude-code/` (Sequential) | `claude-code-teams/` (Parallel) |
|--------|-----------------------------|---------------------------------|
| Phase 3 orchestration | PowerShell `while` loop | Team lead agent + teammates |
| Parallelism | 1 feature at a time | N features simultaneously |
| Context | Fresh per iteration | Persistent per teammate |
| Communication | None (single agent) | Inter-agent messaging |
| Feature claiming | Sequential (no contention) | Atomic claiming with named mutex |
| Code review | None | Mandatory per-feature review |

**Phases 1 & 2 are identical** — the same initializer and validator from the sequential variant.

---

## When to Use Teams vs Sequential

**Use `claude-code-teams/` when:**
- You have 20+ features to implement
- Features are independent (different files, no heavy cross-dependencies)
- You want per-feature code review
- You want faster wall-clock completion

**Use `claude-code/` when:**
- Fewer than 20 features
- Features are highly interdependent (each builds on the previous)
- You want simpler debugging (one agent at a time)
- You're running on resource-constrained hardware

---

## Quick Start

```powershell
# 1. Copy framework to your project
Copy-Item -Recurse powershell\* my-project\
cd my-project

# 2. Initialize git
git init && git add . && git commit -m "Initial commit with Ralph Teams framework"

# 3. Write your PRD (or use the assistant)
.\ralph-teams.ps1 author

# 4. Run everything
.\ralph-teams.ps1 auto
```

---

## How It Works

```
Phase 1: INIT          Phase 2: VALIDATE        Phase 3: TEAM IMPLEMENT
+------------+         +---------------+         +-------------------+
| prd.md     |  --->   | feature_list  |  --->   | Team Lead         |
| (you write)|         | coverage check|         |   |               |
+------------+         | (loops)       |         |   +-- Impl-1      |
                       +---------------+         |   +-- Impl-2      |
                                                 |   +-- Impl-3      |
                                                 |   +-- Reviewer    |
                                                 +-------------------+
```

### Phase 3: Agent Teams

1. **Team Lead** reads `feature_list.json`, creates a team, spawns N implementer teammates + 1 reviewer
2. **Implementers** work in parallel — each claims a feature (atomic, mutex-protected), implements it with TDD, commits, and notifies the reviewer
3. **Reviewer** reviews each completed feature using the `/code-review` skill. If it passes, the feature is marked `complete`. If it fails, findings go back to an implementer.
4. **Implementers don't wait for review** — they move on to the next feature immediately
5. When all features are done, the team lead shuts down all teammates

---

## Commands

| Command | What It Does |
|---------|--------------|
| `.\ralph-teams.ps1 auto` | Run everything automatically |
| `.\ralph-teams.ps1 author` | Interactive PRD creation assistant |
| `.\ralph-teams.ps1 init` | Phase 1: PRD -> features |
| `.\ralph-teams.ps1 validate` | Phase 2: Ensure coverage |
| `.\ralph-teams.ps1 run` | Phase 3: Team implement |
| `.\ralph-teams.ps1 status` | Show current project state |
| `.\ralph-teams.ps1 help` | Show all options |

### Team-Specific Flags

| Flag | Default | Description |
|------|---------|-------------|
| `-Teammates N` | 3 | Number of parallel implementer agents |
| `-SkipReview` | off | Skip per-feature code review (faster, less safe) |

### Examples

```powershell
.\ralph-teams.ps1 auto                                    # 3 implementers + reviewer
.\ralph-teams.ps1 auto -Teammates 5                       # 5 implementers + reviewer
.\ralph-teams.ps1 run -Teammates 2 -SkipReview            # 2 implementers, no review
.\ralph-teams.ps1 auto -DangerouslySkipPermissions        # Full tool access
.\ralph-teams.ps1 auto -v -DebugMode                      # Verbose + debug
```

---

## Concurrency Model

### Feature Claiming
- `claim-feature.ps1` uses a named mutex (`Global\RalphFeatureListMutex`) to prevent two teammates from claiming the same feature
- `claimed_by` field in `feature_list.json` tracks who owns what

### Shared State Protection
- All companion scripts (`update-feature-status`, `increment-feature-attempts`, `get-next-feature`) use the same named mutex
- Named mutex works cross-process on Windows and auto-releases on crash

### Git Conflicts
- Teammates commit directly (no serialization through the lead)
- Features are independent by design (different files)
- Rare conflicts are resolved inline by the teammate

### Dual Tracking
- **Team task list**: coordination/claiming (ephemeral, session-scoped)
- **feature_list.json**: persistent truth (survives session crashes)
- Both updated on completion

---

## Observability

### Structured Progress Logging

All agents write timestamped, grepable entries to `claude-progress.txt`:

```
[2026-02-12 08:52] [TEAM] Created ralph-implement team: 2 implementers + 0 reviewer (SkipReview), 69 features remaining
[2026-02-12 08:52] [SPAWN] implementer-1 (general-purpose)
[2026-02-12 08:56] [CLAIM] implementer-2 claimed F002: Create TodoApi.ServiceDefaults project
[2026-02-12 08:59] [TEST] F005 PASS - 1 test green
[2026-02-12 08:59] [GIT] F005 committed aa1435b by implementer-2
[2026-02-12 10:09] [DONE] All 69 features complete. Final: 126 unit + 11 integration = 137 tests, all green.
```

| Tag | Agent | Meaning |
|-----|-------|---------|
| `[TEAM]` | Team Lead | Team created (teammate count, features remaining) |
| `[SPAWN]` | Team Lead | Teammate spawned |
| `[CLAIM]` | Implementer | Feature claimed |
| `[TEST]` | Implementer | Test pass/fail result |
| `[GIT]` | Implementer | Commit hash and feature ID |
| `[FIX]` | Implementer | Bug fix applied during implementation |
| `[IMPLEMENTED]` | Team Lead | Feature implemented, awaiting review |
| `[COMPLETE]` | Team Lead | Feature review passed |
| `[REVIEW-START]` | Reviewer | Starting review |
| `[REVIEW-PASS]` | Reviewer | Review passed |
| `[REVIEW-FAIL]` | Reviewer | Review failed with issues |
| `[BLOCKED]` | Team Lead | Feature blocked after max attempts |
| `[PROGRESS]` | Team Lead | Periodic summary (every 3 completed features) |
| `[DONE]` | Implementer/Lead | All features complete |

### Live Monitoring

Run `report-team-progress.ps1` in a **separate terminal** while the team is working:

```powershell
# One-time snapshot
.\report-team-progress.ps1

# Continuous watch (refreshes every 5 seconds)
.\report-team-progress.ps1 -Watch -Interval 5
```

Output includes a progress bar, status breakdown, and per-feature table with ID, status, claimed_by, and attempt count.

### Post-Run Report

When Phase 3 completes, `ralph-teams.ps1` automatically displays:
- Elapsed time
- Completion percentage
- List of completed features (with implementer name and attempt count)
- List of blocked features (with error messages)
- List of in-progress features (may indicate crashed teammates)

```
================================================================
  POST-RUN REPORT
================================================================

  Summary: 69 complete | 0 in-progress | 0 pending | 0 blocked  (100% done)

  COMPLETED (69)
    F001: Create TodoApi.sln  [by: implementer-1, attempts: 1]
    F002: Create ServiceDefaults  [by: implementer-1, attempts: 1]
    ...

================================================================
```

---

## Feature Lifecycle

```
pending
  -> in_progress (implementer claims via claim-feature.ps1)
    -> implemented (tests pass, committed)
      -> review (reviewer runs /code-review)
        -> complete (review passes)
        OR
        -> fix needed (review fails -> fix-it task -> re-review)
```

---

## Project Structure

```
claude-code-teams/
├── README.md                        # This file
├── CLAUDE.md                        # Framework docs
├── QUICKSTART.md                    # Quick start
├── powershell/
│   ├── ralph-teams.ps1              # Main launcher
│   ├── report-team-progress.ps1     # Live progress monitor (run in separate terminal)
│   ├── prompts/
│   │   ├── initializer.md           # Phase 1 (same as sequential)
│   │   ├── validator.md             # Phase 2 (same as sequential)
│   │   ├── team-lead.md             # Phase 3: Team lead orchestration
│   │   ├── team-implementer.md      # Phase 3: Implementer for team context
│   │   └── team-reviewer.md         # Phase 3: Per-feature code reviewer
│   └── .claude/
│       ├── settings.json            # CLI configuration
│       ├── rules/                   # Auto-loaded coding rules
│       └── skills/
│           ├── ralph/               # Core skills (mutex-protected)
│           │   ├── claim-feature/   # NEW: Atomic feature claiming
│           │   ├── get-next-feature/
│           │   ├── update-feature-status/
│           │   ├── increment-feature-attempts/
│           │   ├── get-feature-stats/
│           │   ├── prd-author/
│           │   └── validate-prd/
│           ├── docs-lookup/
│           ├── get-branch-name/
│           ├── nuget-manager/
│           └── test-driven-development/
├── templates/                       # PRD and config templates
└── examples/                        # Example projects
```

---

## PowerShell 5.1 Compatibility

The framework is compatible with **PowerShell 5.1** (the default on Windows Server 2025 and Windows 10/11). Key adaptations:

- **Prompt passing**: Multi-line prompts are written to a temp file (`.ralph-prompt-temp.md`) instead of passed directly as arguments. PS 5.1 splits multi-line strings at newlines when splatting to native commands, and lines starting with `--` get misinterpreted as CLI flags.
- **No ternary operators**: PS 5.1 doesn't support `$x = condition ? a : b` syntax.
- **No here-string interpolation edge cases**: Avoids `@"..."@` patterns that parse differently in 5.1.
- **UTF-8 without BOM**: All file writes use explicit UTF-8 encoding to avoid PS 5.1's ANSI default.

The framework also works on PowerShell 7+ with no changes.

---

## Troubleshooting

### "Timeout: Could not acquire lock on feature_list.json"
A script couldn't acquire the named mutex within 30 seconds. This usually means another process crashed while holding the lock. The mutex auto-releases on process exit, so restarting should fix it.

### Features getting claimed by crashed teammates
The `claimed_by` field persists in `feature_list.json`. If a teammate crashes mid-feature, the feature stays `in_progress` with its `claimed_by` set. A new teammate with the same name will pick it up via `claim-feature.ps1`.

### Git conflicts between teammates
Features should be independent by design. If conflicts occur frequently, your features may need better decomposition. Each feature should touch different files.

### Team doesn't terminate after all features complete
The team lead's shutdown negotiation may hang after all features are marked complete. The Claude process stays running even though work is done. The post-run report will still display correctly — you can safely stop the process manually (Ctrl+C or stop the background task). This is a known issue with Claude Code's `SendMessage` shutdown protocol.

### .NET 10 record validation attributes
If using .NET 10 with record DTOs, Data Annotations like `[Required]` and `[StringLength]` must use `[param:]` target instead of `[property:]`. The framework agents discovered this during testing — earlier .NET versions used `[property:]`.

---

## Learn More

- Sequential variant: `../claude-code/`
- Original technique: https://ghuntley.com/ralph/
