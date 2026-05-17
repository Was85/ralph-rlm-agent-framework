# Autonomous Code Factory Redesign

**Date:** 2026-04-08
**Status:** Draft
**Scope:** Ralph runtime redesign for unattended PRD-to-code execution

## Problem

Ralph is currently too chat-shaped and too fragile for unattended execution. It can:

- continue past incomplete validation
- hide framework rejections in log files instead of console output
- lose useful retry context across new LLM context windows
- drift between runner-specific implementations
- fail noisily when a feature is too large instead of decomposing it safely

The target behavior is different: a user provides a PRD, starts Ralph, leaves for a while, and comes back to either:

1. a coherent completed backlog with verified code, or
2. a precise terminal report explaining exactly why Ralph stopped.

## Goals

- Accept a PRD and autonomously derive a runnable backlog
- Execute features unattended with persistent retry memory
- Retry routine failures without human intervention
- Decompose repeatedly failing features into smaller child features without changing the original requirement
- Preserve clear progress, dependency ordering, and traceability
- Support `claude`, `copilot`, and `codex` as first-class runners behind one framework loop
- Produce compact, framework-first runtime output that explains decisions clearly

## Non-Goals

- Backward compatibility with current runtime behavior
- Preserving the current linked branch execution model
- Trusting agent prose as proof of success
- Allowing the runtime to silently weaken acceptance criteria

## Solution

Re-center Ralph around a deterministic state machine with one scheduler truth on disk, one isolated worktree per active feature, hard verification gates, and explicit autonomous recovery phases:

1. `init` builds the initial backlog from the PRD
2. `validate` confirms coverage and stops if coverage is not good enough
3. `optimize` sharpens stories before implementation
4. `run` executes one feature at a time in an isolated worktree
5. if a feature fails, Ralph retries with persistent lessons
6. if retries are exhausted, Ralph may decompose the feature into child features while preserving the original requirement exactly
7. if decomposition also fails, Ralph stops the entire run with a terminal report

## Architecture

### 1. Runtime Model

`feature_list.json` remains the scheduler source of truth, but the feature schema is expanded to support unattended execution:

```json
{
  "id": "F023",
  "description": "Original feature requirement",
  "status": "pending",
  "attempts": 0,
  "max_attempts": 5,
  "last_error": null,
  "notes": null,
  "depends_on": [],
  "source_requirement": "REQ-23",
  "related_files": [],
  "acceptance_criteria": [],
  "verification_steps": [],
  "parent_feature_id": null,
  "split_from": null,
  "child_feature_ids": [],
  "decomposition_state": null
}
```

Additional parent/child states:

- `pending`
- `in_progress`
- `complete`
- `blocked`
- `decomposed`

`decomposed` is non-runnable. It acts as a placeholder dependency gate and is considered satisfied only when all child features are complete.

### 2. Retry And Learning Model

Each feature gets:

- configurable `max_attempts` with a default of `5`
- hard cap of `10`
- persistent `attempt_history`
- per-feature failure notes under `.ralph/features/<id>/`

New artifacts:

- `attempt-log.json`
- `failure-summary.md`
- `decomposition-report.json` when applicable

Before every retry, the planner and implementer receive:

- prior failure summaries
- the last valid contract, if any
- current diff and artifact state
- lessons from prior attempts

This gives the LLM durable memory even when it starts in a new context window.

### 3. Feature Decomposition

After normal retries are exhausted, Ralph may enter a controlled decomposition phase.

Rules:

- The original requirement must not be changed
- Acceptance intent must be preserved
- The parent feature remains in the backlog
- Child features are added as smaller runnable units
- Child IDs use stable suffixes such as `F023a`, `F023b`, `F023c`
- Downstream features keep depending on the parent placeholder, not each child directly

Decomposition flow:

1. mark parent feature as `decomposed`
2. write decomposition report and rationale
3. insert child features with `split_from: "F023"` and `parent_feature_id: "F023"`
4. recalculate stats and dependency graph
5. continue execution from the new ready child features

If any child chain reaches terminal failure, Ralph stops the run and marks the parent as blocked.

### 4. Worktree Isolation

Sequential execution uses one isolated git worktree per active feature.

Required properties:

- each feature attempt gets a fresh worktree
- the main checkout remains the scheduler and merge boundary
- framework-owned artifacts are copied into and back out of the worktree
- merge and post-merge verification happen on the main branch only after harness approval

This keeps context windows small, reduces accidental state bleed, and aligns with the requirement that Ralph should pick the next feature with fresh context.

### 5. Runner Adapter Model

Runners become adapters under one common interface.

Supported runners:

- `claude`
- `copilot`
- `codex`

Core runner capabilities:

- prompt invocation
- timeout handling
- permission-flag mapping
- auth/preflight check
- optional stream capture
- prompt delivery via inline text or temp-file fallback

The scheduler, retry logic, decomposition logic, and verification gates must not branch on runner type. Only the adapter layer may contain runner-specific behavior.

### 6. Verification Model

Verification remains framework-owned.

A feature only completes when all of the following hold:

- contract artifact is valid
- implementation report is valid
- exactly one feature-scoped implementation commit exists
- changed files stay within allowed scope
- required build/test commands pass
- verifier artifact is valid
- post-merge verification passes on the main branch

Agent prose is never enough. The framework prints the actual verdict.

### 7. Runtime Output

Console output becomes framework-first and decision-oriented.

For each feature, Ralph prints a compact lifecycle:

1. selected feature
2. planner result
3. contract review result
4. implementation result
5. framework verdict
6. verification result
7. next action

If the agent says "done" but the framework rejects it, Ralph must print the rejection reason immediately. No silent retry path.

### 8. Stop Conditions

Ralph must stop the whole run when a feature reaches terminal blocked state after:

- normal retries, and
- optional decomposition retries

Terminal stop report must include:

- blocked feature ID
- source requirement
- attempt count
- decomposition attempted or not
- last blocking error
- affected dependent features
- recommended human action

## File Changes

Expected redesign touch points:

- `src/commands/auto.ts`
- `src/commands/run.ts`
- `src/team/team-orchestrator.ts`
- `src/core/harness-runner.ts`
- `src/core/runtime-state.ts`
- `src/core/feature-store.ts`
- `src/core/scheduler.ts`
- `src/core/verification.ts`
- `src/runners/runner.ts`
- `src/runners/runner-factory.ts`
- `src/runners/claude-runner.ts`
- `src/runners/copilot-runner.ts`
- `src/runners/codex-runner.ts`
- `src/ui/*` for run output cleanup

New likely modules:

- `src/core/feature-decomposition.ts`
- `src/core/attempt-memory.ts`
- `src/core/terminal-report.ts`

## Testing

Required verification before rollout:

1. Unit tests for retry progression and terminal stop behavior
2. Unit tests for decomposition bookkeeping and dependency preservation
3. Unit tests for runner adapter selection, including `codex`
4. Integration tests for sequential worktree isolation
5. Integration tests for framework-first rejection output
6. Smoke tests against `C:\Projects\Nodinite\Nodinite.Agent.Frends\Nodinite.Agent.Frends`

Smoke scenarios must cover:

- feature retries that later succeed
- feature retries that trigger decomposition
- terminal blocked stop after max retries
- resumed run after interruption
- runner selection for `claude`, `copilot`, and `codex`

## External Notes

Runner design should assume current official CLI capabilities for:

- GitHub Copilot coding agent / autopilot / plan flows in the GitHub CLI documentation
- OpenAI Codex CLI terminal-agent workflows in the OpenAI documentation
- Anthropic Claude Code slash commands, subagents, hooks, settings, and plan-mode workflows in the Anthropic documentation

Those details belong in runner adapters and preflight checks, not in scheduler logic.

Claude-specific note:

- the Claude runner may optionally use slash commands, subagents, skills, hooks, or plan-mode-compatible prompt shaping to improve execution quality
- Ralph core correctness must never depend on those features being available
- if Claude-specific capabilities are unavailable, the same feature lifecycle must still work through the standard runner contract

## Decision

Implement the redesign on top of the stable harness model, not the linked branch drift. Port useful verification and prompt-delivery improvements selectively, but keep the unattended execution model deterministic, isolated, and framework-owned.
