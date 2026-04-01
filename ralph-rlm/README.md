# ralph-rlm

Ralph is an AI development harness that turns a PRD into working software through a framework-owned loop instead of a chat-owned loop.

You describe the whole project in `prd.md`. Ralph decomposes it into small features, validates coverage, sharpens weak stories, then runs each ready feature through a strict `planner -> implementer -> verifier` pipeline. Code is only accepted after merge verification passes on the branch Ralph was started from.

This repository now reflects the smoke-proven redesign:
- framework-owned state transitions
- full backlog visibility
- per-feature artifacts under `.ralph/features/<id>/`
- resumable runtime state under `.ralph/runtime/`
- one clean feature commit per approved feature
- post-merge verification before the next feature unlocks

Based on Geoffrey Huntley's Ralph Wiggum technique, with a stronger long-running harness design and durable repo artifacts.

## Changelog

### v4.2.0

- **Fix: test file inference for non-`src/` paths** — `inferTestFile` now falls back to matching any recognized source file extension when the path doesn't start with `src/`. This fixes initialization failures for .NET and other project layouts where source files live under project-specific directories (e.g., `Controllers/FooController.cs`, `Models/SourceType.cs`).
- **Fix: init and optimize turn budgets** — Init and optimize phases now use dedicated turn budgets (25 main / 15 repair) instead of sharing the user-tunable `--max-agent-turns` default (3). These phases process the entire feature list and need substantially more turns than per-feature work.

### v4.1.0

- Add `--max-agent-turns` CLI flag to configure agent iteration limits.

### v4.0.0

- Full redesign with framework-owned state transitions, worktree isolation, and post-merge verification.

## What Ralph Does

Ralph is for this workflow:

1. Write a real requirements document.
2. Let Ralph generate a feature backlog.
3. Let Ralph validate and improve that backlog.
4. Let Ralph implement one ready feature at a time, or multiple ready features in team mode.
5. Require proof, not claims, before marking work complete.

Ralph is not just "ask Claude to keep going". The framework owns:
- feature scheduling
- feature status changes
- artifact lifecycle
- worktree isolation
- merge policy
- verification policy
- runtime recovery state

The coding agent writes plans, code, and review artifacts. Ralph decides what counts as success.

## Core Model

Each feature goes through these steps:

1. Planner reads `assignment.json` and writes `contract.json`.
2. Evaluator reviews that contract and writes `contract-review.json`.
3. Implementer makes the code change, creates exactly one feature-scoped commit, and writes `implementation-report.json`.
4. Verifier reviews the real code and reruns the expected checks, then writes `verification-report.json`.
5. Ralph merges the approved work.
6. Ralph reruns build and test commands on the branch Ralph was started from and writes `post-merge-verification.json`.

If any of that fails, Ralph retries or blocks the feature. It does not silently mark success.

## Why This Version Is Different

The current redesign fixed the weak parts of the earlier framework:

- Ralph no longer hides unrelated features just to force sequencing. It keeps the full backlog visible and selects the next ready work by dependency, priority, and attempts.
- The coding agent no longer owns the lifecycle. Ralph owns status transitions in `feature_list.json`.
- The verifier is separate from the implementer.
- Completion requires a real commit, real artifact files, and real rerunnable verification.
- Runtime state survives interruption and can be resumed from repo files alone.
- Sequential and team mode are both validated against a real todo CRUD sample.

## Requirements

- Node.js 18+
- Git
- One supported AI runner installed globally:
  - Claude Code
  - GitHub Copilot CLI

Claude is the default runner.

## Install

Install from npm:

```bash
npm install -g @alcinanet/ralph-rlm
```

Then use:

```bash
ralph --help
```

For framework development in this repo:

```bash
cd ralph-rlm
npm install
npm run build
```

## Quick Start

```bash
cd your-project
git init

ralph scaffold
ralph author
# or write prd.md manually

ralph auto --optimize
```

That runs:

1. `init`
2. `validate`
3. `optimize`
4. `run`

If you prefer to drive phases explicitly:

```bash
ralph init
ralph validate
ralph optimize
ralph run
ralph status
```

### Fastest Way To Start

If you are new to Ralph, do not start with every phase manually. The shortest usable path is:

1. Run `scaffold` once.
2. Write a real `prd.md`.
3. Run `auto --optimize`.
4. Check `status`.

For Claude:

```bash
cd your-project
git init
ralph scaffold
# write prd.md
ralph auto --optimize
ralph status
```

For Copilot:

```bash
cd your-project
git init
ralph scaffold --runner copilot
# write prd.md
ralph auto --runner copilot --optimize
ralph status
```

Start in sequential mode first. After that, use team mode only when the backlog has multiple independent ready features:

```bash
ralph run --team --teammates 3
```

You do not need to edit `.ralph/` files directly unless you are debugging a blocked run.

## Recommended Workflow

### 1. Scaffold

`ralph scaffold` creates the project support files Ralph expects, including:
- a PRD template
- runner-specific AI instructions
- project prompt override directories

Use it once per project.

In this framework repo, the canonical examples Ralph ships from live under
`ralph-rlm/scaffold-assets/templates/` and `ralph-rlm/scaffold-assets/claude/`.
Repo-root `prd.md`, `templates/`, `.claude/`, and `.ralph/` copies are local
project scaffolding, not the framework source of truth.

### 2. Write the PRD

Write the whole project in `prd.md`, not just the next endpoint.

Good PRDs include:
- user-facing behavior
- error handling
- validation rules
- expected tests
- technical constraints

Ralph works best when the PRD is concrete and complete.

### 3. Generate the Backlog

`ralph init` reads `prd.md` and writes `feature_list.json`.

The generated stories are expected to be:
- atomic
- traceable to the PRD
- small enough for one implementation attempt
- explicit about files, tests, and build commands

### 4. Validate Coverage

`ralph validate` checks that the PRD is actually covered by the backlog.

If coverage is incomplete, Ralph adds missing stories or blocks the run if the PRD is too ambiguous.

### 5. Optimize Story Quality

`ralph optimize` sharpens vague stories before implementation starts.

It improves:
- acceptance criteria
- dependency ordering
- story sizing
- missing coverage

Ralph also applies framework-side quality gates so weak output does not reach `run`.

### 6. Run the Harness

`ralph run` executes the implementation harness over the next ready features.

Sequential mode:
- one ready feature at a time
- isolated worktree
- merge
- post-merge verification
- next feature

Team mode:
- multiple ready features in parallel worktrees
- serialized merge and verification boundary on the branch Ralph was started from
- retry and conflict handling

### 7. Check Runtime State

`ralph status` shows:
- feature progress
- validation status
- runtime session state
- active features
- last completed feature
- whether the run is resumable

## Commands

### `ralph scaffold`

Sets up Ralph files in the current project.

Typical use:

```bash
ralph scaffold
ralph scaffold --runner copilot
```

### `ralph author`

Interactive PRD assistant.

Typical use:

```bash
ralph author
ralph author --runner copilot
```

### `ralph init`

Phase 1. Reads `prd.md` and creates `feature_list.json`.

Typical use:

```bash
ralph init
ralph init --runner copilot
```

### `ralph validate`

Phase 2. Validates PRD coverage against the feature list.

Typical use:

```bash
ralph validate
ralph validate -c 95
```

### `ralph optimize`

Phase 3. Refines the feature list before implementation.

Typical use:

```bash
ralph optimize
```

### `ralph run`

Phase 4. Runs the implementation harness.

Typical use:

```bash
ralph run
ralph run --team --teammates 3
ralph run --runner copilot
```

Options that matter most:
- `--team`: enable parallel worktree mode
- `--teammates`: number of parallel harnesses in team mode
- `--skip-review`: skip final verifier approval after implementation
- `--runner`: `claude` or `copilot`

### `ralph auto`

Runs the full top-level pipeline.

Typical use:

```bash
ralph auto
ralph auto --optimize
```

### `ralph status`

Shows current project and runtime state.

Typical use:

```bash
ralph status
```

### `ralph skill ...`

Internal subcommands used by agent skills and scaffolding.

These are framework support commands, not the primary user workflow.

## Files Ralph Owns

### Project Root

- `prd.md`
- `feature_list.json`
- `validation-state.json`
- `claude-progress.txt`

### Feature Artifacts

For each feature:

```text
.ralph/features/F001/
  assignment.json
  contract.json
  contract-review.json
  implementation-report.json
  verification-report.json
  post-merge-verification.json
```

Meaning:
- `assignment.json`: the feature handoff Ralph prepared
- `contract.json`: the planner's implementation contract
- `contract-review.json`: evaluator approval or rejection of that contract
- `implementation-report.json`: implementer summary of what changed and what commands were run
- `verification-report.json`: verifier replay and acceptance decision
- `post-merge-verification.json`: framework verification after merge on main

### Runtime State

Ralph persists long-running execution state under:

```text
.ralph/runtime/
  session-state.json
  events.json
  features/
    F001.json
```

Meaning:
- `session-state.json`: current run, mode, phase, summary, active features, resumed lineage
- `events.json`: append-only runtime event log
- `features/<id>.json`: per-feature runtime history, attempts, worktree info, merge info, verification info

## Feature Quality Rules

Ralph now rejects weak stories before implementation.

The backlog is expected to satisfy these rules:
- every feature has `priority`
- every feature has `depends_on`, even if empty
- every feature has `source_requirement`
- every feature has `related_files`
- related files are safe relative paths
- stories stay small, typically 1-4 files
- dependency ordering must make sense
- build and test commands must be represented
- non-UI work must carry real unit or integration test evidence
- UI work must carry real E2E evidence

This matters because it keeps `run` focused on implementable work instead of vague backlog cleanup.

## Scheduling

Ralph does not hide the rest of the backlog anymore.

Scheduling behavior:
- full backlog stays visible
- only ready features can run
- priority and attempts influence ordering
- blocked dependencies prevent downstream work from being dispatched
- if no ready work remains, Ralph stops as `blocked` instead of spinning until max iterations

## Sequential Mode

Sequential mode is the simplest and safest path.

What it does:
- picks the next ready feature
- creates a disposable worktree
- runs planner, review, implementation, and verifier
- merges approved work
- reruns verification on main
- moves to the next ready feature

What it guarantees:
- feature-scoped isolation
- explicit retry boundaries
- no silent status mutation by the coding agent

## Team Mode

Team mode parallelizes ready features using git worktrees.

What team mode does:
- creates one worktree per active feature
- runs the same harness in each worktree
- merges one approved result at a time
- reruns build and tests after each merge
- reverts failed post-merge verification

What team mode does not do:
- it does not let concurrent harnesses write directly to the main checkout
- it does not skip the verifier or post-merge verification boundary

## Verification Rules

Ralph now requires real proof before completion.

Examples of enforced checks:
- planner must write a valid `contract.json`
- contract reviewer must write a valid `contract-review.json`
- implementer must create exactly one feature-scoped commit
- commit subject must match the contract
- implementation report commit SHA must match HEAD
- changed files must stay within approved scope
- required commands must appear in the report
- verifier must write a valid `verification-report.json`
- verifier must include required command results and acceptance results
- main-branch verification must pass after merge

If any of these fail, the feature is retried or blocked.

## Runtime Recovery

Ralph is built to survive interrupted runs.

Recovery behavior:
- session state is written continuously
- per-feature runtime history is persisted
- `status` can detect resumable runs
- resumed sessions track `resumed_from_run_id`
- worktrees use per-attempt names to avoid resume collisions

If a run is interrupted, resume with:

```bash
ralph run
```

or:

```bash
ralph run --team
```

depending on the original mode.

## Smoke Validation In This Repo

This repository includes a real todo CRUD smoke harness for framework development.

Run from the package directory:

```bash
cd ralph-rlm
npm run smoke:todo
```

Variants:

```bash
npm run smoke:todo:sequential
npm run smoke:todo:team
npm run smoke:todo -- --runner copilot
npm run smoke:todo -- --keep-workdir
```

What it does:
- builds the current Ralph CLI from source
- creates a fresh sequential todo repo from the checked-in PRD fixture
- runs `init`, `validate`, `optimize`, `run`, and `status`
- verifies the finished repo with `npm run build` and `npm test`
- creates a team-mode continuation repo from a proven baseline fixture
- runs `ralph run --team`
- verifies the finished repo with `npm run build` and `npm test`

Important note:
- the smoke wrapper is a real end-user run, so team mode can take a long time if the AI runner is slow
- `--keep-workdir` is useful when you want to inspect the generated repos after the smoke finishes
- the smoke assertions follow the actual completed feature ids, not a hardcoded final feature like `F008`

## Proven State Of The Framework

The current redesign is not just theory. It has been validated on real todo CRUD smoke repos.

Smoke-proven outcomes:
- fresh sequential Claude smoke completes end to end
- fresh sequential Copilot smoke completes end to end
- team Claude smoke completes end to end from the preserved baseline fixture
- fresh team Copilot smoke completes end to end from the preserved baseline fixture
- the final sequential and team repos both reach `8/8` complete in the current todo fixture
- the final sequential and team repos both pass `status`
- the final sequential and team repos both pass `npm run build`
- the final sequential and team repos both pass `npm test`

## Customization

Ralph prefers project-local prompt overrides in:

```text
.ralph/prompts/
```

If those files do not exist, it falls back to the framework defaults packaged with Ralph.

This lets you tune:
- planner behavior
- implementer instructions
- evaluator behavior
- initializer and optimizer prompts

without changing the framework itself.

## Troubleshooting

### A feature is blocked

Check:
- `feature_list.json`
- `.ralph/features/<id>/`
- `.ralph/runtime/features/<id>.json`

Look for:
- bad contract
- weak or missing evidence
- merge failure
- failed post-merge verification
- true requirement ambiguity

### `status` says the run is blocked

That usually means one of these:
- all remaining features are blocked
- dependencies are blocked
- no ready work remains

Ralph now reports this explicitly instead of failing as a fake iteration timeout.

### A retry keeps failing

Inspect the feature artifacts and runtime history, then either:
- fix the underlying codebase issue
- sharpen the feature definition
- split the story
- reset the feature after manual correction

### Team mode feels slow

That is usually the runner, not the orchestrator. Team mode still enforces merge and post-merge verification boundaries, so it is intentionally safer than "let all agents write to main".

## Exit Codes

High-level behavior:
- `0`: success
- `1`: failed
- `2`: blocked and needs human intervention

## Summary

Ralph is now a durable implementation harness, not a prompt convention.

It gives you:
- PRD-driven planning
- story quality gates
- full backlog scheduling
- planner / implementer / verifier separation
- feature-scoped artifacts
- resumable runtime state
- sequential and team execution
- real smoke-proven verification

If you want one command to build from a PRD, use:

```bash
ralph auto --optimize
```

If you want the most control, use the phases explicitly and inspect `status` plus `.ralph/` artifacts as Ralph progresses.
