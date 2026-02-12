# CLAUDE.md - Ralph Loop Framework v2.0 Teams Edition

This project uses the **Ralph Loop Framework v2.0 Teams Edition** for autonomous parallel AI development.

This is the **agent teams** variant. For the sequential variant, see `../claude-code/`.

---

## Three-Phase Architecture

### Phase 1: Initializer Agent (First Run)
- User provides `prd.md` with requirements
- Claude analyzes and creates `feature_list.json` (50-200 atomic features)
- Does NOT write application code
- **Identical to sequential variant**
- Run with: `.\ralph-teams.ps1 init`

### Phase 2: Validator Agent (Loops Until Coverage Met)
- Cross-checks PRD against feature_list.json
- Finds gaps (requirements without matching features)
- Auto-adds missing features
- Loops until coverage >= 95%
- **Identical to sequential variant**
- Run with: `.\ralph-teams.ps1 validate`

### Phase 3: Team Implement (Parallel Agent Teams)
- **Team Lead** coordinates N implementer teammates + 1 reviewer
- **Implementers** claim features atomically via `claim-feature.ps1`
- **Reviewer** reviews each completed feature via `/code-review` skill
- Features only reach `complete` after passing review
- No PowerShell loop — Claude handles coordination internally
- Run with: `.\ralph-teams.ps1 run [-Teammates N] [-SkipReview]`

---

## What is Ralph Loop?

Ralph Loop is an iterative AI coding methodology where:

1. An AI agent works on ONE feature at a time
2. If tests fail, the agent logs the error
3. The agent tries a different approach (or another agent picks it up)
4. Repeat until success (or max attempts reached)

The **Teams Edition** parallelizes step 1: multiple agents work on different features simultaneously.

> "Ralph is a Bash loop." — Geoffrey Huntley
> "Ralph Teams is an agent swarm." — This variant

---

## Project Structure

```
claude-code-teams/
├── powershell/                # PowerShell variant
│   ├── ralph-teams.ps1        # Main entry point
│   ├── prompts/               # Agent prompts
│   │   ├── initializer.md     # Phase 1 (same as sequential)
│   │   ├── validator.md       # Phase 2 (same as sequential)
│   │   ├── team-lead.md       # Phase 3: Team orchestration
│   │   ├── team-implementer.md# Phase 3: Parallel implementer
│   │   └── team-reviewer.md   # Phase 3: Code reviewer
│   └── .claude/
│       ├── skills/ralph/      # Companion scripts (mutex-protected)
│       │   └── claim-feature/ # NEW: Atomic feature claiming
│       └── rules/             # Auto-loaded coding rules
│
└── (shared docs: README.md, QUICKSTART.md, CLAUDE.md)
```

Auto-created files in your project:

```
project/
├── prd.md                 # Your requirements (YOU write this)
├── feature_list.json      # Features with status + claimed_by tracking
├── validation-state.json  # Validation coverage tracking
├── claude-progress.txt    # Iteration log with failure details
└── .claude/
    ├── skills/ralph/      # Core skills with mutex locking
    └── rules/             # Auto-loaded coding rules
```

---

## Key Files

### `feature_list.json`
Same as sequential, plus one new optional field per feature:
- `claimed_by`: Which teammate owns this feature (e.g., `"implementer-1"`)

### `claim-feature.ps1` (NEW)
Atomic feature claiming under named mutex. Prevents two teammates from claiming the same feature.

---

## Skills (`.claude/skills/`)

### Core Ralph Skills (`ralph/`)
All write operations are mutex-protected (`Global\RalphFeatureListMutex`):
- **claim-feature** (NEW) — Atomically claim a feature for a teammate
- **get-next-feature** — Find the next pending/in-progress feature
- **update-feature-status** — Change feature status
- **increment-feature-attempts** — Track failed attempts
- **get-feature-stats** — Get project stats (read-only, no mutex needed)

### User-Invocable Skills
- **prd-author** (`/prd-author`) — Interactive PRD authoring assistant

### Utility Skills
- **test-driven-development** — TDD enforcement
- **validate-prd** — PRD quality checklist
- **docs-lookup** — API verification
- **nuget-manager** — NuGet package management
- **get-branch-name** — Branch naming conventions

---

## Rules (`.claude/rules/`)

Auto-loaded by Claude Code based on file path patterns:

| Rule | Applies To | Purpose |
|------|-----------|---------|
| `csharp.md` | `**/*.cs` | C# coding conventions |
| `playwright-dotnet.md` | `**/*Tests.cs`, `**/*Test.cs` | Playwright .NET test patterns |

---

## Running the Framework

```powershell
.\ralph-teams.ps1 auto                 # All phases (3 implementers + reviewer)
.\ralph-teams.ps1 auto -Teammates 5    # All phases with 5 implementers
.\ralph-teams.ps1 author               # PRD authoring assistant
.\ralph-teams.ps1 init                 # Phase 1: PRD -> features
.\ralph-teams.ps1 validate             # Phase 2: Ensure coverage
.\ralph-teams.ps1 run                  # Phase 3: Team implement
.\ralph-teams.ps1 status               # Check status

# Flags
.\ralph-teams.ps1 run -Teammates 5 -SkipReview                    # 5 impl, no review
.\ralph-teams.ps1 auto -DangerouslySkipPermissions -DebugMode     # Full access + debug
```

---

## Concurrency Safety

All companion scripts that write to `feature_list.json` use a named mutex (`Global\RalphFeatureListMutex`):

```powershell
$mutex = [System.Threading.Mutex]::new($false, "Global\RalphFeatureListMutex")
try {
    $mutex.WaitOne(30000)
    # read-modify-write
}
finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
```

This prevents concurrent corruption when multiple teammates write simultaneously.

---

## Completion Detection

Same as sequential — data-driven from `feature_list.json`:
- All features `"complete"` → done
- Some `"blocked"` → human intervention needed
- Still `"pending"`/`"in_progress"` → work continues

---

## Safety

Same as sequential:
- All progress committed to git
- Named mutex prevents file corruption
- `claimed_by` survives crashes
- Stats auto-repaired after each phase

---

## Philosophy

> "The technique is deterministically bad in an undeterministic world."
> — Geoffrey Huntley

The Teams Edition adds: **bad in parallel is faster than bad in serial.**
