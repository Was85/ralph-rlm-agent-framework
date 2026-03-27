# ralph-rlm

An autonomous AI development framework that turns a requirements document into working software — automatically.

You write a **PRD** (Product Requirements Document) describing what you want built. Ralph breaks it into features, validates coverage, and implements them one by one using AI coding agents (Claude Code or GitHub Copilot). When the AI fails, it sees that failure in the next iteration and tries a different approach. This continues until every feature passes.

Based on [Geoffrey Huntley's Ralph Wiggum technique](https://ghuntley.com/ralph/). Enhanced with [RLM (Recursive Language Model)](https://arxiv.org/abs/2512.24601) exploration for large codebases. The optimize phase is inspired by [Andrej Karpathy's autoresearch](https://github.com/karpathy/autoresearch) — an AI agent refines the feature specifications before implementation, the same way autoresearch evolves training code through automated experimentation.

> "The technique is deterministically bad in an undeterministic world. It's better to fail predictably than succeed unpredictably." — Geoffrey Huntley

## Why Ralph?

Ralph is designed for building entire projects from a single requirements document, without manual code review between features. Traditional AI coding asks one question at a time and hopes the AI gets it right. Ralph takes a different approach:

- **You describe the whole project** in a PRD — all requirements, edge cases, error handling
- **Ralph decomposes it** into 50-200 small, atomic features (each completable in one AI session)
- **Ralph validates** that every requirement maps to a feature (95%+ coverage required)
- **Ralph optimizes** the feature list — an AI agent sharpens descriptions, splits vague features, and reorders dependencies so implementation succeeds more often
- **Ralph implements** features in a loop — if a feature fails, the next iteration sees the error and tries differently
- **Failures are data** — each failed attempt teaches the next iteration what NOT to do

This works because:
1. Small features (2-4 files each) fit in one AI context window
2. Fresh context on each retry avoids the AI getting stuck in bad patterns
3. Progress is checkpointed to git after each iteration
4. Features can be blocked and resumed later with human help

## What You Need

- **Node.js 18+** (check with `node --version`)
- **Git** (Ralph uses git for safety checkpoints — run `git init` in your project)
- One AI coding CLI installed globally:
  - [Claude Code](https://github.com/anthropics/claude-code) — `npm install -g @anthropic-ai/claude-code` (**default**)
  - [GitHub Copilot CLI](https://github.com/features/copilot/cli) — use with `--runner copilot`

## Install

```bash
npm install -g @alcinanet/ralph-rlm
```

This gives you the `ralph` command globally.

## Quick Start

```bash
cd your-project
git init                          # Ralph needs a git repo

# Step 1: Set up project files
ralph scaffold                    # Creates .claude/skills/, rules, prd.md template

# Step 2: Write your requirements
ralph author                      # Interactive assistant helps you write prd.md
# OR edit prd.md manually

# Step 3: Let Ralph build it
ralph auto                        # Runs init → validate → run
ralph auto --optimize             # Runs init → validate → optimize → run
```

## The Four Phases

Ralph works in four sequential phases. You can run them individually or all at once with `ralph auto`.

### Phase 1: Initialize (`ralph init`)

Reads your `prd.md` and creates `feature_list.json` — a structured list of atomic features with acceptance criteria, priority ordering, and dependency chains.

**Input:** `prd.md` (your requirements)
**Output:** `feature_list.json` (50-200 features)

Each feature is small enough for one AI session (2-4 files, 2-3 sentence description). Features are ordered by priority and dependency so they can be implemented sequentially.

### Phase 2: Validate (`ralph validate`)

Cross-checks your PRD against the feature list to ensure nothing was missed. Loops until coverage reaches 95%+ (configurable with `-c`).

**Input:** `prd.md` + `feature_list.json`
**Output:** `validation-state.json` (coverage %, gaps found)

If gaps are found, the validator automatically adds missing features and updates `feature_list.json`. If requirements are ambiguous, it marks the validation as "blocked" for human review.

The validation state is cached in `validation-state.json`. Running `ralph auto` will skip Phase 2 if validation is already `complete`. If you later change `prd.md`, delete `validation-state.json` to force re-validation.

### Phase 3: Optimize (`ralph optimize`)

Refines `feature_list.json` so every feature is small, detailed, and fully traceable to the PRD. An AI agent reads your PRD and the current feature list, then applies four types of mutations:

- **SHARPEN** — rewrites vague acceptance criteria to be explicit and testable
- **SPLIT** — breaks large features into 2-3 smaller, atomic ones
- **REORDER** — fixes dependency ordering so blockers are resolved first
- **COMPLETE** — adds features that exist in the PRD but were missed during init

**Input:** `prd.md` + `feature_list.json`
**Output:** Improved `feature_list.json`

The optimizer never writes code — it only edits the specification. This is inspired by [Karpathy's autoresearch](https://github.com/karpathy/autoresearch): instead of improving the implementation, improve the instructions the implementer receives.

To enable in `ralph auto`, add `--optimize`:

```bash
ralph auto --optimize              # Runs: init → validate → optimize → run
```

Or run standalone:

```bash
ralph optimize                     # Single-pass optimization, then stop
```

The optimizer prompt is customizable — `ralph scaffold` copies `optimizer.md` to `.ralph/prompts/` where you can tune the mutation strategy for your project.

### Phase 4: Implement (`ralph run`)

The core loop. For each pending feature:
1. AI picks up the next feature
2. AI reads acceptance criteria, implements the code, runs tests
3. If tests pass → feature marked `complete`, move to next
4. If tests fail → error logged, feature stays `in_progress`, next iteration retries with fresh context (up to 5 attempts by default)
5. If stuck after max attempts → feature marked `blocked` for human help

**Input:** `feature_list.json` + your codebase
**Output:** Working code, committed to git

The loop exits when:
- All features are `complete` (success)
- All remaining features are `blocked` (needs human help)
- Max iterations reached (default 50; check progress with `ralph status` and resume with `ralph run`)

**When a feature is blocked**, you can:
1. Check `last_error` in `feature_list.json` to see what went wrong
2. Fix the issue in your codebase or clarify the feature's `description`/`acceptance_criteria`
3. Reset `"status": "pending"` and `"attempts": 0` in the JSON
4. Re-run `ralph run` to retry

## Three Modes

Ralph supports three modes of operation. All use the same CLI — just different flags.

### 1. Sequential with Claude Code (Default)

```bash
ralph auto
```

One AI agent works on one feature at a time. Simplest mode, works for any project size. (`ralph auto` runs all three phases in sequence — for parallel implementation, use `ralph run --team` after validation.)

### 2. Sequential with GitHub Copilot

```bash
ralph auto --runner copilot
```

Same as above but uses GitHub Copilot CLI instead of Claude Code. Use `--allow-all-tools` for fully autonomous mode.

### 3. Parallel Team Mode

```bash
ralph run --team --teammates 3
```

Multiple features are built simultaneously using **git worktrees** for isolation. Each agent works in its own worktree branch, and results are merged back to the main branch after verification. Best for projects with many independent features.

Team mode differences:
- **Git worktree isolation** — each agent works in a separate worktree, so parallel agents never interfere with each other
- **Dependency-aware scheduling** — features are grouped by dependency level; independent features run in parallel, dependent ones wait
- **Auto-merge with verification** — after each agent completes, its branch is merged and build+tests are re-run; failed merges are reverted automatically
- **Conflict serialization** — features that conflict twice in parallel are dispatched solo in the next iteration
- **Rebase-before-merge** — worktree branches are rebased onto HEAD before merging to reduce conflicts
- **Default: 2 parallel agents** — configurable with `--teammates N`

```
Sequential                           Team (--team)
+----------------------+             +---------------------------+
|  while (pending) {   |             |  Orchestrator             |
|    invoke AI         |             |    +-- Worktree-1 (F001)  |
|    check status      |             |    +-- Worktree-2 (F002)  |
|  }                   |             |  Merge → Verify → Next    |
|  1 feature at a time |             |  N features in parallel   |
+----------------------+             +---------------------------+
```

## CLI Reference

### `ralph scaffold`

Sets up project files for Ralph in the current directory. Run this once per project.

**What it does step by step:**

1. Locates the `scaffold-assets/` directory inside the installed npm package
2. Copies `templates/` folder into your project (contains starter `feature_list.json`, `prd.md`, `validation-state.json` templates)
3. If `--runner claude` (default):
   - Creates `.claude/skills/ralph/` with SKILL.md files — these are instructions that Claude Code discovers at runtime, telling it how to call `ralph skill` subcommands
   - Creates `.claude/rules/` with coding standard rules that Claude Code auto-loads when editing matching file types
   - Creates `.claude/settings.json` with recommended Claude Code settings
4. If `--runner copilot`:
   - Creates `.github/instructions/` with instruction files for GitHub Copilot (Ralph workflow, C# coding standards, plus a template for your own)
   - Creates `.github/skills/ralph/` with SKILL.md files — same Ralph skills as the Claude version, in Copilot's agent skills format
5. Creates `prd.md` from the template (a structured starter document with sections for Project Overview, Functional Requirements, Non-Functional Requirements, etc.)
6. **Skips any file/directory that already exists** — safe to re-run without overwriting your changes

```bash
ralph scaffold                    # Default: scaffold for Claude Code
ralph scaffold --runner copilot   # Scaffold for GitHub Copilot instead
```

| Option | Default | Description |
|--------|---------|-------------|
| `--runner` | `claude` | Which AI tool to scaffold for: `claude` or `copilot` |

**Returns:** `0` on success, `1` if scaffold-assets not found or file I/O errors.

---

### `ralph author`

Interactive PRD creation assistant. Launches an AI conversation that walks you through writing a comprehensive `prd.md`.

**What it does step by step:**

1. **Preflight checks** — verifies git repo exists and the AI CLI is installed
2. **Loads the PRD Author skill** — reads the SKILL.md file from the installed package's `.claude/skills/ralph/prd-author/` directory (this contains detailed instructions for how the AI should guide you)
3. **Strips YAML frontmatter** — removes any `---` metadata block from the skill file
4. **Launches an interactive AI session** — the AI walks you through multiple phases:
   - **Phase 1: Project Understanding** — asks about your project, tech stack, goals
   - **Phase 2: Requirements Deep Dive** — functional requirements, edge cases, error handling
   - **Phase 3: Test Expectations** — what tests should exist, coverage expectations
   - **Phase 4: Feature Sizing** — helps you think about feature granularity
5. **Saves `prd.md`** — the AI writes the final requirements document to your project directory
6. If a `templates/prd.md` exists (from `ralph scaffold`), the AI uses it as the output structure
7. **Verifies the output** — confirms `prd.md` was created, suggests next steps (`ralph auto`)

```bash
ralph author                                      # Claude (interactive)
ralph author --runner copilot                     # Copilot (interactive)
ralph author --dangerously-skip-permissions       # Claude, no permission prompts
```

| Option | Default | Description |
|--------|---------|-------------|
| `--runner` | `claude` | AI runner: `claude` or `copilot` |
| `--dangerously-skip-permissions` | `false` | Skip tool permission prompts (Claude) |
| `--allow-all-tools` | `false` | Same as above (Copilot convention) |
| `--verbose` | `false` | Show debug info |
| `--debug` | `false` | Full debug tracing |

**Returns:** `0` if `prd.md` created successfully, `1` if it wasn't created or preflight checks failed.

---

### `ralph init`

Phase 1. Reads `prd.md` and creates `feature_list.json` with 50-200 atomic features. Runs once — if `feature_list.json` already exists, `ralph auto` skips this phase.

**What it does step by step:**

1. **Preflight checks** — verifies git repo exists, AI CLI is installed, `prd.md` exists, and prompt files are available in the installed package
2. **Git safety checkpoint** — runs `git stash push -m "ralph-pre-init" --include-untracked` to save any uncommitted work before the AI starts modifying files (if nothing to stash, this is silently skipped)
3. **Loads the initializer prompt** — reads `prompts/initializer.md` from the installed package (this is a detailed instruction template that tells the AI exactly how to decompose a PRD into atomic features)
4. **Invokes the AI** — runs Claude Code or Copilot CLI with the prompt + `"Read the project requirements from: prd.md"`. The AI:
   - Reads your `prd.md`
   - Breaks every requirement into small, atomic features (2-4 files each, 2-3 sentence description)
   - Writes acceptance criteria for each feature
   - Orders features by priority and dependency
   - Calculates initial stats (total, pending counts)
   - Writes everything to `feature_list.json`
5. **Validates the output** — checks that `feature_list.json` was actually created and is valid JSON. Reports the feature count (e.g., "Created 87 features in feature_list.json")
6. **Returns exit code** — `0` on success, `1` if `feature_list.json` wasn't created or couldn't be parsed

```bash
ralph init                                        # Parse PRD, create features
ralph init --runner copilot                       # Use Copilot
ralph init --dangerously-skip-permissions         # No permission prompts
ralph init --debug                                # Full debug tracing
```

**Requires:** `prd.md`, git repo, AI CLI installed

| Option | Default | Description |
|--------|---------|-------------|
| `--runner` | `claude` | AI runner: `claude` or `copilot` |
| `--dangerously-skip-permissions` | `false` | Skip tool permission prompts |
| `--allow-all-tools` | `false` | Same as above |
| `--verbose` | `false` | Show context summary |
| `--debug` | `false` | Full debug tracing |
| `--stream` | `false` | Stream JSON output (Claude only) |

---

### `ralph validate`

Phase 2. Cross-checks PRD against feature list. Loops until coverage >= threshold or max iterations reached.

**What it does step by step:**

1. **Preflight checks** — verifies git repo, AI CLI, `prd.md`, `feature_list.json`, and prompt files
2. **Creates validation state** — if `validation-state.json` doesn't exist yet, creates it with `status: "in_progress"` and a timestamp
3. **Enters the validation loop** (up to `--max-validate-iterations`, default 10):
   - **Loads the validator prompt** — reads `prompts/validator.md` from the installed package
   - **Invokes the AI** — tells it to read `prd.md`, `feature_list.json`, and `validation-state.json`. The AI:
     - Maps every PRD requirement to at least one feature
     - Identifies any gaps (requirements with no matching feature)
     - If gaps found → automatically creates new features and adds them to `feature_list.json`
     - Calculates a coverage percentage (features covering requirements / total requirements)
     - Updates `validation-state.json` with the coverage %, gap list, and status
   - **Checks for completion**:
     - If `coverage_percent >= threshold` (default 95%) → exits with success
     - If `status === "blocked"` → exits with warning (ambiguous requirements need human review)
     - Otherwise → waits `--sleep-between` seconds (default 2) and loops again
4. **Returns exit code** — `0` if coverage met, `2` if blocked (human review needed), `1` if max iterations reached without meeting threshold

```bash
ralph validate                                    # Default: 95% coverage, 10 iterations
ralph validate -c 80                              # Lower coverage threshold to 80%
ralph validate --max-validate-iterations 20       # Allow up to 20 attempts
ralph validate -s 5                               # 5 second pause between iterations
```

**Requires:** `prd.md`, `feature_list.json`, git repo, AI CLI installed

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--runner` | | `claude` | AI runner: `claude` or `copilot` |
| `--max-validate-iterations` | | `10` | Max validation loops before stopping |
| `--coverage-threshold` | `-c` | `95` | Coverage % required to pass |
| `--sleep-between` | `-s` | `2` | Seconds between iterations |
| `--dangerously-skip-permissions` | | `false` | Skip tool permission prompts |
| `--allow-all-tools` | | `false` | Same as above |
| `--verbose` | `-v` | `false` | Show context summary |
| `--debug` | | `false` | Full debug tracing |
| `--stream` | | `false` | Stream JSON output (Claude only) |

---

### `ralph optimize`

Phase 3. Runs an AI agent that refines `feature_list.json` — sharpening acceptance criteria, splitting vague features, fixing dependency order, and adding missing PRD coverage.

**What it does step by step:**

1. **Preflight checks** — verifies git repo, AI CLI, `feature_list.json`, and prompt files
2. **Loads the optimizer prompt** — reads `.ralph/prompts/optimizer.md` (user-customizable), falling back to the framework default
3. **Invokes the AI** — tells it to read `prd.md`, `feature_list.json`, and `claude-progress.txt`, then improve the feature list using four mutations: SHARPEN, SPLIT, REORDER, COMPLETE
4. **Validates output** — checks `feature_list.json` is still valid JSON with the correct schema
5. **Returns exit code** — `0` on success, `1` if `feature_list.json` is missing or output is invalid

```bash
ralph optimize                               # Single-pass optimization
ralph optimize --runner copilot              # Use Copilot instead of Claude
```

**Requires:** `feature_list.json`, `prd.md`, git repo, AI CLI installed

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--runner` | | `claude` | AI runner: `claude` or `copilot` |
| `--dangerously-skip-permissions` | | `false` | Skip tool permission prompts |
| `--allow-all-tools` | | `false` | Same as above |
| `--verbose` | `-v` | `false` | Show context summary |
| `--debug` | | `false` | Full debug tracing |
| `--stream` | | `false` | Stream JSON output (Claude only) |

---

### `ralph run`

Phase 4. The implementation loop. Picks up features one by one, implements them, and checks results. Also supports parallel team mode. (Phase 3 when `--optimize` is not used.)

**What it does step by step (sequential mode):**

1. **Preflight checks** — verifies git repo, AI CLI, `feature_list.json`, and prompt files
2. **Git safety checkpoint** — runs `git stash push -m "ralph-pre-implement" --include-untracked` to save any uncommitted work
3. **Pre-loop check** — reads `feature_list.json` and counts remaining features:
   - If 0 remaining and 0 blocked → already done, exits with `0`
   - If 0 remaining but N blocked → exits with `2` (human help needed)
   - Otherwise → reports count and starts the loop
4. **Enters the implementation loop** (up to `--max-iterations`, default 50):
   - **Windows cleanup** — removes accidental `nul` file if the AI created one (Windows-specific edge case)
   - **Loads the implementer prompt** — reads `prompts/implementer.md` from the installed package
   - **Invokes the AI** — the AI discovers the SKILL.md files (set up by `ralph scaffold`), which tell it how to:
     - Call `ralph skill get-next-feature` to pick the next pending/in_progress feature
     - Read the acceptance criteria
     - Implement the code
     - Run the test command from `feature_list.json` config
     - Call `ralph skill update-feature-status --id F001 --status complete` if tests pass
     - Call `ralph skill increment-feature-attempts --id F001 --error "..."` if tests fail
   - **Recalculates stats** — reads `feature_list.json`, recalculates all counts from the features array (safety net in case the AI wrote incorrect stats), writes back
   - **Checks exit conditions**:
     - All features complete → exits with success `0`
     - All remaining are blocked → exits with `2` (human help needed)
     - 0 features in file → exits with `1` (corruption detected)
     - Otherwise → logs progress (e.g., "5/20 complete, 15 remaining"), waits `--sleep-between` seconds, loops again
5. **Returns exit code** — `0` if all complete, `2` if blocked, `1` if max iterations reached

**What it does step by step (team mode with `--team`):**

1. **Routes to TeamOrchestrator** instead of the sequential loop
2. **Pre-loop setup**:
   - Cleans up orphaned worktrees from previous crashed runs
   - Commits framework files (`.ralph/`, `.claude/`) so worktree merges work cleanly
3. **Enters the team loop** (up to `--max-iterations`):
   - **Builds execution plan** — analyzes feature dependencies and groups independent features into levels
   - **Creates git worktrees** — one per agent, each on its own branch (`ralph/F001`, `ralph/F002`, etc.)
   - **Dispatches agents in parallel** — each agent works in its isolated worktree on one feature
   - **Merges results sequentially** — for each completed feature:
     - Ensures clean working tree (stash or reset)
     - Rebases the worktree branch onto HEAD
     - Merges with `--no-ff`
     - Runs build + test verification
     - Reverts the merge if verification fails
   - **Conflict handling** — features that conflict 2+ times are dispatched solo in the next iteration
   - **Cleans up worktrees** after each batch
   - **Checks exit conditions** — all complete, all blocked, or max iterations

```bash
# === Sequential (default) ===
ralph run                                         # Implement features one at a time
ralph run -m 100                                  # Allow up to 100 iterations
ralph run --dangerously-skip-permissions          # No permission prompts

# === Team mode (parallel) ===
ralph run --team                                  # 3 parallel agents + reviewer
ralph run --team --teammates 5                    # 5 parallel agents + reviewer
ralph run --team --teammates 5 --skip-review      # 5 agents, no reviewer
```

**Requires:** `feature_list.json`, git repo, AI CLI installed

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--runner` | | `claude` | AI runner: `claude` or `copilot` |
| `--max-iterations` | `-m` | `50` | Max implementation loops before stopping |
| `--sleep-between` | `-s` | `2` | Seconds between iterations |
| `--dangerously-skip-permissions` | | `false` | Skip tool permission prompts |
| `--allow-all-tools` | | `false` | Same as above |
| `--verbose` | `-v` | `false` | Show context summary |
| `--debug` | | `false` | Full debug tracing |
| `--stream` | | `false` | Stream JSON output (Claude only) |
| `--team` | | `false` | Enable parallel team mode |
| `--teammates` | | `3` | Number of implementer agents (team mode) |
| `--skip-review` | | `false` | Skip code review step (team mode) |

---

### `ralph auto`

Runs all phases in sequence. Skips phases that are already complete — this makes it safe to re-run after interruptions or partial completions.

**What it does step by step:**

1. **Shows banner** — displays the Ralph-RLM header
2. **Phase 1: Init** — checks if `feature_list.json` exists:
   - If **no** → runs `ralph init` (PRD → features). If init fails, stops immediately.
   - If **yes** → skips init, logs "feature_list.json exists, skipping init phase"
3. **Phase 2: Validate** — checks if `validation-state.json` exists and has `status: "complete"`:
   - If **not validated** → runs `ralph validate` (coverage loop)
     - If validation returns `blocked` (exit code 2) → stops with "Human review needed"
     - If validation returns `1` (incomplete but not blocked) → logs a warning but **continues to implementation anyway** (partial coverage is better than no implementation)
   - If **already validated** → skips validate, logs "Validation already complete, skipping validate phase"
4. **Phase 3: Optimize** (only with `--optimize`) — runs `ralph optimize` to sharpen feature descriptions before implementation. Skipped by default.
5. **Phase 4: Implement** — runs `ralph run` (the implementation loop). This is the main phase that builds your project.
6. **Returns the exit code from Phase 4** — `0` if all features complete, `2` if blocked, `1` if max iterations reached

**Resumability:** Because each phase checks for existing files before running, you can:
- Run `ralph auto`, let it run for a while, interrupt it (Ctrl+C)
- Run `ralph auto` again — it picks up where it left off (init/validate already done, implementation resumes from the next pending feature)

```bash
ralph auto                                        # Run everything, defaults
ralph auto --optimize                             # Include optimize phase before implementation
ralph auto --runner copilot --allow-all-tools     # Copilot, fully autonomous
ralph auto --dangerously-skip-permissions         # Claude, fully autonomous
ralph auto -m 100 -c 80                           # 100 iterations, 80% coverage
ralph auto --debug                                # Full debug tracing
```

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--runner` | | `claude` | AI runner: `claude` or `copilot` |
| `--optimize` | | `false` | Run optimize phase before implementation |
| `--max-iterations` | `-m` | `50` | Max Phase 4 iterations |
| `--max-validate-iterations` | | `10` | Max Phase 2 iterations |
| `--coverage-threshold` | `-c` | `95` | Coverage % required |
| `--sleep-between` | `-s` | `2` | Seconds between iterations |
| `--dangerously-skip-permissions` | | `false` | Skip tool permission prompts |
| `--allow-all-tools` | | `false` | Same as above |
| `--verbose` | `-v` | `false` | Show context summary |
| `--debug` | | `false` | Full debug tracing |
| `--stream` | | `false` | Stream JSON output (Claude only) |

**Returns:** `0` if all phases complete, `1` if max iterations reached, `2` if blocked (human help needed).

**Note:** Team mode (`--team`, `--teammates`, `--skip-review`) is not supported with `ralph auto`. For parallel implementation, run phases individually: `ralph init` → `ralph validate` → `ralph optimize` → `ralph run --team`.

---

### `ralph status`

Shows current project state. Useful for checking progress mid-run or diagnosing issues.

**What it does step by step:**

1. **Checks `prd.md`** — reports whether it exists
2. **Checks `feature_list.json`** — if it exists, parses it and shows:
   - Total feature count
   - Breakdown by status: complete, in_progress, pending, blocked
   - Overall progress percentage (complete / total × 100)
3. **Checks `validation-state.json`** — if it exists, shows:
   - Coverage percentage
   - Validation status (in_progress, complete, or blocked)
4. **Checks `claude-progress.txt`** — if it exists, shows line count (each line is a log entry from an iteration)
5. **Suggests the next action** based on current state:
   - No `prd.md` → "Create prd.md with your requirements"
   - No `feature_list.json` → "Run: ralph init"
   - Validation incomplete → "Run: ralph validate"
   - Features remaining → "Run: ralph run"
   - Only blocked features left → "N feature(s) blocked. Fix in feature_list.json, then: ralph run"
   - Everything complete → "All done!"

```bash
ralph status
```

No options. Reads the current directory.

---

### `ralph skill <name>`

Skill subcommands used internally by AI agents during the implement loop. The AI discovers these through the SKILL.md files created by `ralph scaffold`, which tell it what commands are available and when to call them.

You can also run these manually for debugging or scripting (e.g., checking project state from CI, resetting a feature, building custom automation around the feature lifecycle).

All skills read/write `feature_list.json` directly. Every write operation automatically recalculates the `stats` block (total, complete, in_progress, pending, blocked counts) to keep it consistent.

All skills accept `--path` to specify the `feature_list.json` location (default: `./feature_list.json`).

#### `ralph skill get-next-feature`

Returns the next feature to implement as a JSON object (with `id`, `description`, `status`, `acceptance_criteria`, etc.). Priority: in_progress first (retry scenario), then first pending. Returns `{ "result": "ALL_COMPLETE" }` when all features are complete or blocked.

```bash
ralph skill get-next-feature
ralph skill get-next-feature --path ./my-project/feature_list.json
```

| Option | Default | Description |
|--------|---------|-------------|
| `--path` | `feature_list.json` | Path to feature list file |

#### `ralph skill get-feature-stats`

Returns project stats (total, complete, in_progress, pending, blocked counts) and config. Does NOT include the full features array.

```bash
ralph skill get-feature-stats
```

| Option | Default | Description |
|--------|---------|-------------|
| `--path` | `feature_list.json` | Path to feature list file |

#### `ralph skill update-feature-status`

Updates a feature's status. Clears `last_error` when status is set to `complete`. Recalculates stats. Idempotent — setting the same status twice is a no-op.

```bash
ralph skill update-feature-status --id F001 --status in_progress
ralph skill update-feature-status --id F001 --status complete
ralph skill update-feature-status --id F001 --status blocked
```

| Option | Default | Description |
|--------|---------|-------------|
| `--id` | **(required)** | Feature ID (e.g., `F001`) |
| `--status` | **(required)** | New status: `pending`, `in_progress`, `complete`, `blocked` |
| `--path` | `feature_list.json` | Path to feature list file |

#### `ralph skill increment-feature-attempts`

Increments the attempt counter for a feature and optionally records an error message. Recalculates stats after write.

```bash
ralph skill increment-feature-attempts --id F001
ralph skill increment-feature-attempts --id F001 --error "Build failed: CS1002"
```

| Option | Default | Description |
|--------|---------|-------------|
| `--id` | **(required)** | Feature ID (e.g., `F001`) |
| `--error` | | Error message to store in `last_error` |
| `--path` | `feature_list.json` | Path to feature list file |

#### `ralph skill claim-feature`

Claims the next available feature for a teammate (team mode only). Returns the claimed Feature object on success. If the teammate already has an in_progress feature, returns that one instead (retry scenario). Returns `{ "result": "ALL_CLAIMED" }` when no unclaimed features remain.

```bash
ralph skill claim-feature --teammate implementer-1
ralph skill claim-feature --teammate implementer-2 --path ./feature_list.json
```

| Option | Default | Description |
|--------|---------|-------------|
| `--teammate` | **(required)** | Teammate name (e.g., `implementer-1`) |
| `--path` | `feature_list.json` | Path to feature list file |

## Examples

```bash
# === Most common usage ===

ralph auto                                    # Run everything, Claude, sequential

# === Copilot users ===

ralph auto --runner copilot --allow-all-tools # Run everything, Copilot, autonomous

# === Team mode (large projects) ===

ralph run --team                              # 3 parallel agents (default)
ralph run --team --teammates 5                # 5 parallel agents
ralph run --team --skip-review                # Skip code review step

# === Tweaking behavior ===

ralph auto -m 100                             # Allow up to 100 implementation iterations
ralph validate -c 80                          # Accept 80% coverage instead of 95%
ralph run -m 10                               # Only run 10 iterations, then stop
ralph auto -s 5                               # 5 second pause between iterations

# === Debugging ===

ralph run --debug                             # Full debug tracing
ralph run -v                                  # Verbose output with context summaries
ralph status                                  # Check current progress

# === Autonomous mode (faster, less safe) ===

ralph auto --dangerously-skip-permissions     # Claude: no permission prompts
ralph auto --runner copilot --allow-all-tools # Copilot: no permission prompts

# === Streaming (CI/automation) ===

ralph auto --stream                           # Stream JSON output from Claude
```

## Project Files

### Files You Create

| File | Description |
|------|-------------|
| `prd.md` | Your requirements. Include functional requirements, non-functional requirements, error handling, edge cases, tech stack. The more detail, the better the features. |

### Files Ralph Creates

| File | Created By | Description |
|------|------------|-------------|
| `feature_list.json` | `ralph init` | All features with status, attempts, errors, acceptance criteria |
| `validation-state.json` | `ralph validate` | Coverage percentage, gaps, validation status |
| `claude-progress.txt` | `ralph run` | Detailed iteration log — what was tried, what failed, theories |

### Files `ralph scaffold` Creates

| Path | Runner | Description |
|------|--------|-------------|
| `.claude/skills/ralph/` | Claude | SKILL.md files (7 skills) — AI agents discover these at runtime and use them to interact with feature_list.json |
| `.claude/rules/` | Claude | Coding standards auto-loaded by Claude Code when working with matching file types (includes templates for C#, Playwright, etc.) |
| `.claude/settings.json` | Claude | Claude Code workspace settings — configures integration with SKILL.md files and rules |
| `.github/skills/ralph/` | Copilot | SKILL.md files (same 7 skills) — Copilot agent skills format |
| `.github/instructions/` | Copilot | Instruction files for coding standards and Ralph workflow guidance |
| `templates/` | Both | Templates for feature_list.json, prd.md, validation-state.json |
| `prd.md` | Both | Starter template for your requirements |

### Feature Statuses

Each feature in `feature_list.json` has a status:

| Status | Meaning | What Happens Next |
|--------|---------|-------------------|
| `pending` | Not started | Will be picked up by the next iteration |
| `in_progress` | Being worked on | AI is currently implementing this (or failed and will retry) |
| `complete` | Done | Tests pass, code committed |
| `blocked` | Stuck | Max attempts reached or unresolvable error. Needs human help. |

### Feature Lifecycle

```
pending -> in_progress -> complete
                |
                v (if tests keep failing)
             blocked (human fixes issue, resets to pending)
```

## How Features Are Tracked

`feature_list.json` example:

```json
{
  "project": "my-app",
  "config": {
    "max_attempts_per_feature": 5,
    "test_command": "npm test",
    "build_command": "npm run build"
  },
  "stats": {
    "total": 8,
    "complete": 3,
    "in_progress": 1,
    "pending": 3,
    "blocked": 1
  },
  "features": [
    {
      "id": "F001",
      "description": "User registration with email and password",
      "status": "complete",
      "attempts": 1,
      "last_error": null,
      "acceptance_criteria": [
        "POST /api/v1/users creates a new user",
        "Password is hashed before storage",
        "Duplicate email returns 409",
        "Unit test: UserServiceTests.Register_ValidInput_CreatesUser passes",
        "Build passes (npm test)"
      ]
    },
    {
      "id": "F005",
      "description": "Input validation on all API endpoints",
      "status": "blocked",
      "attempts": 5,
      "last_error": "Build failed: Cannot find module 'express-validator'"
    }
  ]
}
```

### Feature Fields Reference

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (e.g., `F001`, `F002`) |
| `description` | string | Short description of what to implement |
| `status` | string | `pending`, `in_progress`, `complete`, or `blocked` |
| `attempts` | number | Number of implementation attempts so far |
| `last_error` | string or null | Error message from the most recent failed attempt |
| `acceptance_criteria` | string[] (optional) | List of conditions that must be met for the feature to pass |
| `notes` | string (optional) | Free-form notes for tracking (not used by Ralph internally) |
| `claimed_by` | string or null (optional) | Name of the agent implementing this feature (team mode only) |
| `source_requirement` | string (optional) | Which PRD requirement this feature addresses (set by the validator) |

You can edit this file manually at any time:
- **Add features** — insert new entries with `"status": "pending"` and re-run
- **Unblock features** — fix the issue, reset `"status": "pending"` and `"attempts": 0`
- **Skip features** — set `"status": "complete"` to skip

## Safety

- **Git checkpoints** — Ralph stashes uncommitted changes before each phase (`git stash push -m "ralph-pre-{phase}" --include-untracked`)
- **Max iterations** — configurable limit prevents infinite loops (default: 50 for implementation, 10 for validation)
- **Max attempts per feature** — features that fail too many times (default: 5) are marked `blocked`, not retried forever
- **Stats recalculation** — after every iteration, Ralph recalculates feature counts from the actual features array (safety net against AI writing incorrect stats)
- **Tool permissions** — by default, the AI asks permission for each tool use. Use `--dangerously-skip-permissions` only when you trust the AI to operate autonomously
- **Shell injection prevention** — all git commands use `execFile` (no shell interpolation); user-facing commands are shell-escaped
- **Atomic file writes** — feature_list.json writes use temp file + rename to prevent corruption on crash
- **File locking** — concurrent access to feature_list.json (team mode) uses file-based locks with stale lock detection
- **Schema validation** — feature_list.json is validated on every read to catch corruption early
- **Agent timeout** — configurable timeout with SIGTERM → SIGKILL escalation prevents hung agents
- **Graceful shutdown** — SIGINT/SIGTERM handlers clean up worktrees before exit

## Tips for Better Results

1. **Use `ralph author`** — the interactive assistant helps you write thorough requirements
2. **Be specific** — "Users can register with email" is better than "Add authentication"
3. **Include error cases** — "When email is taken, return 409 with ProblemDetails"
4. **Specify tech stack** — "Use Express, not Fastify" / "Use xUnit, not NUnit"
5. **Include test expectations** — "Unit test verifies X" in acceptance criteria
6. **Right-size requirements** — each should map to 2-4 files max
7. **Add coding rules** — customize `.claude/rules/` for your stack conventions
8. **Check status often** — `ralph status` shows what's complete vs blocked
9. **Add features mid-project** — add to `feature_list.json` with `"status": "pending"` and re-run

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Not a git repository" | Run `git init` in your project |
| "prd.md not found" | Run `ralph scaffold` or `ralph author` |
| "feature_list.json not found" | Run `ralph init` first |
| "Claude Code CLI not found" | `npm install -g @anthropic-ai/claude-code` |
| Feature stuck as "blocked" | Check `last_error` in feature_list.json, fix the issue, reset `status` to `"pending"` and `attempts` to `0` |
| Feature keeps failing after many attempts | Edit the feature's `description` or `acceptance_criteria` to be more specific. Reset `attempts` to `0` and `status` to `"pending"` |
| Validation never reaches 95% | Check `gaps` in validation-state.json. Lower threshold with `-c 80`, or rewrite ambiguous PRD sections to be more specific |
| Hung at "Iteration 1" | AI is waiting for permission. Use `--dangerously-skip-permissions` for autonomous mode |
| Git stash errors | Run `git stash list` then `git stash pop` to recover stashed changes |
| Wrong AI tool | Set `--runner copilot` if you don't have Claude Code installed |
| feature_list.json corrupted | Restore from git: `git checkout feature_list.json`. If no git history, delete it and re-run `ralph init` |
| `ralph auto --team` doesn't work | Team mode is only supported with `ralph run --team`. Run phases individually: `ralph init` → `ralph validate` → `ralph run --team` |
| Team mode: feature stays `in_progress` forever | An agent may have crashed. Check `claimed_by` field. Reset `claimed_by` to `null` and `status` to `"pending"` to unclaim |
| Want to skip a feature | Set `"status": "complete"` manually in feature_list.json |
| Interrupted mid-run | Just re-run `ralph auto` or the specific command — it picks up where it left off. Init and validate phases are skipped if already done |
| Changed requirements after init | Delete `feature_list.json` and `validation-state.json`, then re-run `ralph auto` |

## How Ralph Teaches AI

Ralph doesn't just run the AI blindly — it provides structured context through two mechanisms:

### Prompt Templates (bundled in the npm package)

These are loaded at runtime and passed to the AI CLI as the initial instruction:

| Prompt | Used By | What It Tells the AI |
|--------|---------|---------------------|
| `initializer.md` | `ralph init` | How to decompose a PRD into atomic features with acceptance criteria |
| `validator.md` | `ralph validate` | How to cross-check PRD requirements against features and find gaps |
| `implementer.md` | `ralph run` | How to pick up a feature, implement it, run tests, and report results |
| `team-lead.md` | `ralph run --team` | How to spawn and coordinate a team of implementers |
| `team-implementer.md` | `ralph run --team` | How each implementer should claim and implement features |
| `team-reviewer.md` | `ralph run --team` | How to review completed features for quality |

### SKILL.md Files (created by `ralph scaffold`)

These are placed in your project's `.claude/skills/ralph/` (Claude) or `.github/skills/ralph/` (Copilot) directory. Both agents discover them at runtime and use them to understand what CLI commands are available:

| Skill | What It Describes |
|-------|-------------------|
| `get-next-feature/SKILL.md` | How to call `ralph skill get-next-feature` to pick the next feature |
| `update-feature-status/SKILL.md` | How to call `ralph skill update-feature-status` to mark features complete/blocked |
| `increment-feature-attempts/SKILL.md` | How to record errors after failed attempts |
| `get-feature-stats/SKILL.md` | How to check overall project progress |
| `claim-feature/SKILL.md` | How to atomically claim features in team mode |
| `prd-author/SKILL.md` | How to guide users through writing a PRD (used by `ralph author`) |
| `validate-prd/SKILL.md` | How to validate PRD coverage (used internally by `ralph validate`) |

The AI reads these SKILL.md files, understands the available commands, and calls them as needed during implementation.

## Exit Codes

All commands return standard exit codes:

| Code | Meaning |
|------|---------|
| `0` | **Success** — phase complete, features done, files created |
| `1` | **Error** — git missing, CLI missing, file corrupted, max iterations reached without progress |
| `2` | **Blocked** — features need manual intervention, or validation blocked by ambiguous requirements |

## Resuming After Interruption

Ralph is designed to be safely interrupted and resumed:

1. **Before each phase**, Ralph stashes uncommitted changes with `git stash push -m "ralph-pre-{phase}"`
2. **If you interrupt** (Ctrl+C) during a phase, your work is preserved in the git stash
3. **When you re-run** `ralph auto` or the specific command:
   - Phase 1 (init) is skipped if `feature_list.json` exists
   - Phase 2 (validate) is skipped if `validation-state.json` status is `complete`
   - Phase 3 (implement) resumes from the next pending/in_progress feature

```bash
# To recover stashed changes after interruption:
git stash list                    # See all stashed changes
git stash pop                     # Restore the most recent stash

# To resume from where you left off:
ralph auto                        # Picks up where it left off automatically

# To resume a specific phase:
ralph run                         # Resume implementation only
ralph validate                    # Re-run validation only
```

## Architecture

```
ralph-rlm/
├── src/
│   ├── cli.ts                      # CLI entry point (yargs)
│   ├── config/                     # Types, defaults, config builder
│   ├── core/                       # Data layer and utilities
│   │   ├── feature-store.ts        #   Read/write feature_list.json (atomic, locked)
│   │   ├── validation-store.ts     #   Read/write validation-state.json
│   │   ├── file-lock.ts            #   File-based locking with stale detection
│   │   ├── safe-exec.ts            #   Shell-safe command execution (gitExec, safeExecCommand)
│   │   ├── stats.ts                #   Recalculate stats from features
│   │   ├── preflight.ts            #   Pre-run checks (git, CLI, files)
│   │   └── progress-log.ts         #   Append to progress file
│   ├── commands/                   # Phase commands
│   │   ├── init.ts                 #   Phase 1: PRD -> features
│   │   ├── validate.ts             #   Phase 2: coverage loop
│   │   ├── run.ts                  #   Phase 3: implementation loop
│   │   ├── auto.ts                 #   All phases
│   │   ├── status.ts               #   Show project state
│   │   ├── author.ts               #   Interactive PRD assistant
│   │   ├── scaffold.ts             #   Set up project files
│   │   └── skills/                 #   Skill subcommands
│   ├── runners/                    # AI CLI adapters
│   │   ├── claude-runner.ts        #   Claude Code CLI
│   │   ├── copilot-runner.ts       #   GitHub Copilot CLI
│   │   ├── shell-spawn.ts          #   Shell-escaped process spawning
│   │   └── runner-factory.ts       #   Creates runner from --runner flag
│   ├── team/                       # Parallel mode (git worktrees)
│   │   ├── team-orchestrator.ts    #   Dispatch agents, merge results
│   │   ├── worktree-manager.ts     #   Create/merge/cleanup git worktrees
│   │   └── dependency-graph.ts     #   Feature dependency ordering
│   └── ui/                         # Console output
├── prompts/                        # Agent prompt templates (bundled in package)
├── scaffold-assets/                # Project setup templates
└── tests/                          # 315 unit + integration tests
```

## Credits

- Original Ralph Wiggum technique: [Geoffrey Huntley](https://ghuntley.com/ralph/)
- RLM research: [MIT](https://arxiv.org/abs/2512.24601)
- Framework: Waseem

## License

[MIT](./ralph-rlm/LICENSE)
