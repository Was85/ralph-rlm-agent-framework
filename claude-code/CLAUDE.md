# CLAUDE.md - Ralph Loop Framework v2.0

This project uses the **Ralph Loop Framework v2.0** for autonomous AI development.

Two variants are available: **Shell** (bash) and **PowerShell**. Both have identical functionality and prompts.

---

## Three-Phase Architecture

### Phase 1: Initializer Agent (First Run)
- User provides `prd.md` with requirements
- Claude analyzes and creates `feature_list.json` (50-200 atomic features)
- Does NOT write application code
- Run with: `./ralph.sh init` (Shell) or `.\ralph.ps1 init` (PowerShell)

### Phase 2: Validator Agent (Loops Until Coverage Met)
- Cross-checks PRD against feature_list.json
- Finds gaps (requirements without matching features)
- Auto-adds missing features
- Loops until coverage ≥ 95%
- Run with: `./ralph.sh validate` (Shell) or `.\ralph.ps1 validate` (PowerShell)

### Phase 3: Implementer Agent (Loops Until Complete)
- Works on ONE feature at a time
- If tests fail → logs error → exits → loop restarts
- Fresh context sees failure history, tries different approach
- Repeats until all features pass
- Run with: `./ralph.sh run` (Shell) or `.\ralph.ps1 run` (PowerShell)

---

## What is Ralph Loop?

Ralph Loop is an iterative AI coding methodology where:

1. An AI agent works on ONE feature at a time
2. If tests fail, the agent logs the error and exits
3. A bash loop restarts the agent with fresh context
4. The agent sees previous failures and tries a different approach
5. Repeat until success (or max attempts reached)

> "Ralph is a Bash loop." — Geoffrey Huntley

---

## Project Structure

Both variants follow the same structure. Use `shell/` for bash or `powershell/` for PowerShell:

```
claude-code/
├── shell/                     # Bash variant
│   ├── ralph.sh               # Main entry point
│   ├── prompts/               # Agent prompts (references .sh scripts)
│   └── .claude/
│       ├── skills/ralph/      # Companion .sh scripts + SKILL.md
│       └── rules/             # Auto-loaded coding rules
│
├── powershell/                # PowerShell variant
│   ├── ralph.ps1              # Main entry point
│   ├── prompts/               # Agent prompts (references .ps1 scripts)
│   └── .claude/
│       ├── skills/ralph/      # Companion .ps1 scripts + SKILL.md
│       └── rules/             # Auto-loaded coding rules
│
└── (shared docs: README.md, QUICKSTART.md, CLAUDE.md)
```

After copying to your project, auto-created files include:

```
project/
├── prd.md                 # Your requirements (YOU write this)
├── feature_list.json      # Features with status tracking
├── validation-state.json  # Validation coverage tracking
├── claude-progress.txt    # Iteration log with failure details
└── .claude/
    ├── skills/            # Auto-discovered skills
    │   ├── ralph/         # Core Ralph loop skills
    │   │   ├── get-next-feature/
    │   │   ├── update-feature-status/
    │   │   ├── increment-feature-attempts/
    │   │   ├── get-feature-stats/
    │   │   ├── prd-author/        # User-invocable as /prd-author
    │   │   └── validate-prd/
    │   ├── test-driven-development/  # TDD Red-Green-Refactor
    │   ├── docs-lookup/
    │   ├── nuget-manager/
    │   └── get-branch-name/
    └── rules/             # Auto-loaded coding rules
        ├── csharp.md
        └── playwright-dotnet.md
```

---

## Key Files

### `prd.md`
Your Product Requirements Document. Include:
- Functional requirements (what it must DO)
- Non-functional requirements (performance, security)
- Error handling scenarios
- Integration points
- Edge cases

### `feature_list.json`
Tracks all features with:
- `status`: "pending" | "in_progress" | "complete" | "blocked"
- `attempts`: Number of implementation attempts
- `last_error`: Error from most recent failed attempt
- `source_requirement`: (Optional) Which PRD requirement this covers

### `validation-state.json`
Tracks validation coverage:
- `coverage_percent`: How much of the PRD is covered
- `gaps`: Requirements that need features
- `features_added`: Features added by validator

### `claude-progress.txt`
Detailed log of each iteration:
- What was tried
- Exact error messages
- Theories about fixes
- Git commit hashes

---

## Skills (`.claude/skills/`)

Skills are **auto-discovered** by Claude Code from `.claude/skills/`. Each skill has a `SKILL.md` with YAML frontmatter defining `name`, `description`, and `user-invocable`.

### Core Ralph Skills (`ralph/`)
These are used internally by the framework agents during the init/validate/implement loop:
- **get-next-feature** — Find the next pending or in-progress feature
- **update-feature-status** — Change a feature's status (pending → in_progress → complete)
- **increment-feature-attempts** — Track failed attempts with error messages
- **get-feature-stats** — Get project stats overview (counts by status)

### User-Invocable Skills
- **prd-author** (`/prd-author`) — Interactive PRD authoring assistant. Guides you through creating a structured `prd.md` from your project idea.

### Utility Skills
- **test-driven-development** — TDD Red-Green-Refactor enforcement (used by Implementer agent for all feature implementations)
- **validate-prd** — PRD quality checklist for the Validator agent
- **docs-lookup** — API verification guidelines (use when working with unfamiliar APIs)
- **nuget-manager** — Safe NuGet package management for .NET projects
- **get-branch-name** — Generate conventional branch names from feature descriptions

### Companion Scripts
Core Ralph skills include companion scripts for both environments:

**Shell (.sh)**
```bash
.claude/skills/ralph/get-next-feature/get-next-feature.sh
.claude/skills/ralph/update-feature-status/update-feature-status.sh <feature_id> <status>
.claude/skills/ralph/increment-feature-attempts/increment-feature-attempts.sh <feature_id> "<error>"
.claude/skills/ralph/get-feature-stats/get-feature-stats.sh
```

**PowerShell (.ps1)**
```powershell
.claude\skills\ralph\get-next-feature\get-next-feature.ps1
.claude\skills\ralph\update-feature-status\update-feature-status.ps1 -FeatureId F001 -Status in_progress
.claude\skills\ralph\increment-feature-attempts\increment-feature-attempts.ps1 -FeatureId F001 -ErrorMessage "Build failed"
.claude\skills\ralph\get-feature-stats\get-feature-stats.ps1
```

---

## Rules (`.claude/rules/`)

Rules are **auto-loaded** by Claude Code based on file path patterns. When working with files matching a rule's `paths:` glob, the rule's coding standards are automatically active.

| Rule | Applies To | Purpose |
|------|-----------|---------|
| `csharp.md` | `**/*.cs` | C# coding conventions |
| `playwright-dotnet.md` | `**/*Tests.cs`, `**/*Test.cs` | Playwright .NET test patterns |

To add custom rules, create a new `.md` file in `.claude/rules/` with YAML frontmatter:
```yaml
---
paths:
  - "**/*.your-pattern"
---
Your coding standards here...
```

---

## Running the Framework

### Shell (bash)
```bash
./ralph.sh auto       # Automatic (all phases)
./ralph.sh author     # PRD authoring assistant
./ralph.sh init       # Phase 1: PRD -> features
./ralph.sh validate   # Phase 2: Ensure coverage
./ralph.sh run        # Phase 3: Implement
./ralph.sh status     # Check status
```

### PowerShell
```powershell
.\ralph.ps1 auto      # Automatic (all phases)
.\ralph.ps1 author    # PRD authoring assistant
.\ralph.ps1 init      # Phase 1: PRD -> features
.\ralph.ps1 validate  # Phase 2: Ensure coverage
.\ralph.ps1 run       # Phase 3: Implement
.\ralph.ps1 status    # Check status

# PowerShell-specific flags
.\ralph.ps1 run -v -DangerouslySkipPermissions -Stream
.\ralph.ps1 auto -MaxIterations 100 -CoverageThreshold 100
```

---

## Completion Detection

Completion is **data-driven** — the loop queries `feature_list.json` directly after each iteration. No magic strings or signal files.

### Validation Phase
- `"status": "complete"` in validation-state.json → Coverage met, proceed to implementation
- `"status": "blocked"` → Human review needed (ambiguous requirements)

### Implementation Phase
The loop checks feature statuses in `feature_list.json` after each iteration:
- All features `"complete"` (none pending/in_progress/blocked) → Loop exits successfully
- No pending/in_progress but some `"blocked"` → Loop exits, human intervention needed
- Still pending/in_progress features → Loop continues to next iteration
- Max iterations reached → Loop exits, check feature_list.json for progress

### Adding Features Mid-Project
Because completion is derived from the data, you can add new features at any time:
1. Add new entries to `feature_list.json` with `"status": "pending"`
2. Run `./ralph.sh run` — the loop detects remaining work and continues

---

## Safety

The framework allows:
- ✅ Read all files
- ✅ Write/Edit files
- ✅ Git operations
- ✅ Run tests

The framework prevents:
- ❌ Delete files (rm, rmdir)
- ❌ Network calls (curl, wget)
- ❌ Privilege escalation (sudo)

Always run in a git repository for easy rollback.

---

## Philosophy

> "The technique is deterministically bad in an undeterministic world.
> It's better to fail predictably than succeed unpredictably."
> — Geoffrey Huntley

Failures are data. Each failed attempt teaches the next iteration what NOT to do.

The Validation Phase adds an extra layer: ensuring that what we BUILD matches what was REQUESTED. No more lost requirements.
