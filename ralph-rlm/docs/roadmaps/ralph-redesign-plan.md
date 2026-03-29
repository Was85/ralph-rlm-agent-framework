# Ralph Redesign Plan

This file is the durable roadmap for the current breaking redesign of Ralph.

Goal:
- Turn Ralph into a trustworthy long-running implementation harness with:
- full backlog visibility
- feature-scoped artifacts
- commit-after-feature discipline
- independent verification before and after merge
- resumable session state that survives chat/session resets
- end-user smoke validation that proves the workflow on a real sample repo

Non-goals:
- backward compatibility with the old loop
- preserving the old "agent owns feature_list.json mutations" patterns
- adding more prompt complexity without stronger framework controls

## Design Principles

1. The framework owns state transitions.
2. The agent must prove completion; it cannot merely claim completion.
3. Every approved feature produces exactly one feature-scoped commit.
4. A later agent must be able to reconstruct why a feature passed or failed from repo artifacts alone.
5. Story quality must be enforced before implementation starts.
6. Long-running work needs durable memory, resumability, and bounded recovery paths.

## Current Baseline

Already in place:
- planner -> implementer -> evaluator harness structure
- full backlog visibility scheduler
- feature-scoped artifact directory under `.ralph/features/<feature-id>/`
- worktree-based isolation
- stronger commit/scope guards in the harness
- verifier baton with `verification-report.json`
- post-merge verification artifact and gate
- persistent runtime state under `.ralph/runtime/`
- story quality gates during `init` and `optimize`
- sequential end-user smoke validation on a real todo CRUD sample
- guardrails for ephemeral build outputs, `init` stash restoration, and abbreviated commit SHAs

Still missing:
- adversarial smoke cases that prove the verifier catches bad evidence

## Phase Plan

### Phase 1 - Verifier Baton

Outcome:
- A feature is not complete until its claims are independently verified.

Changes:
- Introduce `verification-report.json` and a distinct verifier step.
- Require planner contracts to include:
- feature-scoped acceptance criteria mapping
- exact files expected to change
- exact commands/tests expected to run
- expected commit message or commit subject format
- Require implementer reports to include executed commands and evidence paths.
- Make verifier rerun the claimed feature checks instead of trusting the report.
- Add post-merge verification on the main branch before unlocking the next feature.

Exit criteria:
- Harness rejects success claims that are not reproducible.
- A feature cannot advance if its verifier artifact is missing or failed.
- Tests cover commit count, report validity, failed replay, and failed post-merge verification.

### Phase 2 - Persistent Session State

Outcome:
- Ralph can resume work cleanly after CLI interruption or chat/session loss.

Changes:
- Add project-level memory files under `.ralph/runtime/` or equivalent.
- Persist:
- current phase
- active feature
- last successful artifact path(s)
- retry history
- key decisions / lessons learned
- Add resumable work records for in-flight features.
- Add a background-oriented `watch` or `triage` mode concept after the base persistence exists.

Exit criteria:
- Interrupted runs can resume without re-deriving the whole state from scratch.
- A later session can recover context from repo files alone.

### Phase 3 - Story Quality Gates

Outcome:
- Ralph refuses to implement stories that are too large or under-specified.

Changes:
- Enforce schema-level requirements during `init` and `optimize`:
- business logic stories require unit-test criteria
- UI stories require E2E criteria
- all stories require build/test criteria when applicable
- stories must fit a size budget
- dependencies must be valid and ordered
- Add quality diagnostics so failed stories explain what must be fixed.

Exit criteria:
- Oversized or weak stories are blocked before implementation.
- Generated feature lists are measurably more implementable in one pass.

### Phase 4 - End-to-End Smoke Suite

Outcome:
- Ralph is validated the way an end user would use it.

Changes:
- Create or reuse a minimal todo CRUD sample repo for smoke validation.
- Exercise each major command as a user:
- `init`
- `validate`
- `optimize`
- `run`
- `status`
- team mode where applicable
- Verify:
- each completed feature creates a commit
- story tests are real and rerunnable
- verifier catches fake or incomplete implementations
- post-merge verification blocks bad merges

Exit criteria:
- Smoke scenarios pass on a clean repo.
- Failures produce actionable artifacts, not silent drift.

### Phase 5 - Stabilization And Adversarial Validation

Outcome:
- Ralph's smoke coverage reflects the real failure modes that previously caused silent drift or false retries.

Changes:
- Rewrite README and CLI-facing docs around the smoke-proven harness flow.
- Add smoke scenarios that intentionally:
- fake or omit verification evidence
- leave behind untracked build outputs
- use abbreviated commit SHAs in implementation reports
- interrupt and resume runs mid-flight
- Add a real team-mode smoke pass with worktree merge verification.

Exit criteria:
- Docs accurately describe the runtime-visible behavior and artifact set.
- Sequential and team smoke suites cover both happy-path and adversarial cases.
- Previously observed false failures are permanently covered by tests or smoke automation.

Status:
- README/CLI alignment completed
- live Claude team-mode smoke completed successfully on the todo sample
- verifier hardening, worktree-local prompt resolution, and Claude settings isolation are implemented
- scripted smoke automation exists in `scripts/smoke-todo.mjs`
- fresh greenfield sequential smoke completed successfully on the automated todo sample
- preserved team smoke was resumed to 8/8 complete with build and tests passing
- planner/review recovery and deadlock handling are now covered by unit tests
- adversarial smoke automation remains optional follow-up, not a redesign blocker

## Working Rules For Future Sessions

1. Update this roadmap only when phase scope changes.
2. Update `session-handoff.md` at the end of every meaningful work block.
3. Do not rely on chat history for continuation; rely on repo artifacts and the handoff file.
4. Prefer framework-enforced checks over stronger prompt wording.
5. If a smoke test fails, capture the failure in the handoff before changing code.

## Immediate Next Step

If more work is desired, add one adversarial smoke scenario that fakes or omits verification evidence, then decide whether startup gating for hand-edited `feature_list.json` should be enforced.
