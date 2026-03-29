# Session Handoff

Use this file to resume redesign work without relying on prior chat context.

## Current Goal

Complete the Ralph redesign defined in `docs/roadmaps/ralph-redesign-plan.md`.

## Current Status

Completed:
- planner -> implementer -> evaluator harness exists
- full backlog visibility is in place
- feature-scoped artifacts exist
- commit count and scope guards were tightened in the harness
- Phase 1 verifier baton is implemented:
- `verification-report.json` now replaces the old implementation review artifact
- `post-merge-verification.json` is now written by the framework on the main branch
- contracts now require an exact `commit_message`
- implementation reports now require `commit_sha` and `verification_results`
- the harness now rejects mismatched commit subjects, mismatched commit SHAs, missing required commands, and claimed command failures
- stale harness artifacts are cleaned more aggressively:
- `contract.json` is removed before replanning
- feature harness copy-back now replaces the target directory instead of leaving stale files behind
- Phase 2 persistent runtime state is now in place:
- `.ralph/runtime/session-state.json` stores run-level status, active features, last completed feature, summary, and recent lessons
- `.ralph/runtime/events.json` stores an append-only runtime event log
- `.ralph/runtime/features/<feature-id>.json` stores per-feature attempt history, phase, artifact paths, merge state, and verification command results
- sequential and team runners both write runtime session, event, and feature state updates
- interrupted runs now mark the runtime session as `interrupted` before cleanup
- `status` now reads `.ralph/runtime/session-state.json` and shows runtime mode, phase, active features, resumed run ID, and resume guidance
- runtime sessions now persist `process_id`, so `status` can treat dead `running` sessions as resumable interruptions
- worktree creation now uses per-attempt branch and worktree names, avoiding `ralph/F001 already exists` collisions during retries and resumed runs
- Phase 3 story quality gates are now in place:
- `src/core/feature-quality-gates.ts` enforces small, traceable stories with dependency sanity, required `priority/depends_on/source_requirement/related_files`, safe relative file paths, and a 1-4 file size budget
- `init` and `optimize` now recalculate stats and reject weak `feature_list.json` output before the implementer sees it
- build/test command coverage is enforced from `feature_list.json.config`
- non-UI stories now require explicit unit-test or integration-test evidence and a test file in `related_files`
- UI stories now require explicit Playwright/E2E evidence and a test file in `related_files`
- initializer and optimizer prompts were tightened to match the runtime gate
- Phase 4 sequential smoke validation is now complete:
- a real todo API sample in `smoke/todo-api-e2e-phase4-run` was driven through `init`, `validate`, `optimize`, `run`, and `status`
- the smoke run exposed and fixed three framework bugs:
- `run` no longer retries due to untracked ephemeral build outputs like `dist/` or `coverage/`
- `init` now restores `prd.md` and other local planning files after its safety stash instead of hiding them from `validate`
- harness commit verification now accepts abbreviated SHAs in `implementation-report.json` when they resolve to `HEAD`
- the todo sample now completes all 8 features end to end, with verifier and post-merge checks in place
- the smoke repo now builds and tests cleanly after completion

Validated:
- `npm test -- tests/unit/harness-runner.test.ts tests/unit/commands/run.test.ts tests/unit/team-orchestrator.test.ts tests/integration/team-orchestrator.test.ts tests/unit/config-to-runner.test.ts`
- `npm test -- tests/unit/runtime-state.test.ts tests/unit/ralph-paths.test.ts tests/unit/commands/run.test.ts tests/unit/team-orchestrator.test.ts tests/integration/team-orchestrator.test.ts tests/unit/config-to-runner.test.ts`
- `npm test -- tests/unit/runtime-state.test.ts tests/unit/commands/status.test.ts tests/unit/worktree-manager.test.ts tests/unit/commands/run.test.ts tests/unit/team-orchestrator.test.ts`
- `npm test -- tests/unit/feature-quality-gates.test.ts tests/unit/commands/init.test.ts tests/unit/commands/optimize.test.ts`
- `npm test -- tests/unit/harness-runner.test.ts tests/unit/commands/run.test.ts tests/unit/team-orchestrator.test.ts`
- `npm test -- tests/unit/commands/init.test.ts tests/unit/feature-quality-gates.test.ts tests/unit/commands/optimize.test.ts`
- `npm run build`
- End-user runtime-resume smoke in a temporary workspace:
- interrupting `ralph run` leaves a recoverable runtime snapshot for `F001`
- `status` now reports that stale session as an interruption and tells the user to resume with `ralph run`
- a second interrupted rerun records `resumed_from_run_id` and appends a new `session_started` event linked to the previous run
- End-user smoke run on `smoke/todo-api-e2e-phase4-run`:
- `init` succeeded after the quality-gate and stash fixes
- `validate` succeeded with full feature coverage
- `optimize` returned a valid feature list that passed the stricter gates
- `run` completed all 8 features with feature commits, verification artifacts, and post-merge verification
- `status` reported the completed runtime state correctly
- the smoke repo `npm run build` passed
- the smoke repo `npm test` passed with 26 tests across 5 files
- Live Claude team smoke on `C:\\Temp\\ralph-team-final-smoke`:
- resumed from the Phase 4 baseline after `F002`
- completed `F003` through `F008` with planner, contract review, implementer, verifier, merge, and post-merge verification
- `status` reached 8/8 complete in team mode
- the finished smoke repo `npm run build` passed
- the finished smoke repo `npm test` passed with 17 tests across 5 files
- commit history showed one feature commit plus framework-managed evaluation/state commits per completed feature
- the smoke exposed and fixed two additional framework bugs:
- team worktrees now resolve prompt files from their copied local `.ralph/prompts/` directory
- non-interactive Claude runs now use `--setting-sources project,local` instead of `--bare`, preserving auth while avoiding user-level stop-hook interference

Known gaps:
- On Windows, the `SIGINT` path did not reliably rewrite `session-state.json` from `running` to `interrupted` before exit in the earlier runtime smoke run.
- The framework now compensates for that by storing `process_id` and treating dead `running` sessions as resumable interruptions in `status`.
- The live team smoke still executed one ready feature at a time because the todo backlog dependencies were linear, so it did not prove multi-feature concurrency on the same iteration.
- The repository root still contains redesign scaffolding that may need deliberate cleanup or formalization.
- Smoke automation now exists in `scripts/smoke-todo.mjs` with npm scripts:
- `npm run smoke:todo`
- `npm run smoke:todo:sequential`
- `npm run smoke:todo:team`
- The smoke hardening pass exposed and fixed three more framework issues:
- planner / contract review / verifier phases now retry once with larger budgets for complex or bootstrap stories before consuming a feature-level retry
- sequential and team loops now stop as `blocked` when no ready work remains instead of misreporting `Max iterations reached`
- team dependency planning now excludes pending work whose dependencies are blocked or missing
- Fresh greenfield sequential smoke is now validated on `C:\\Users\\Administrator.DEV\\AppData\\Local\\Temp\\ralph-smoke-8Cv7Ts\\sequential`:
- `status` shows 8/8 complete with a completed sequential runtime session
- `npm run build` passed
- `npm test` passed with 23 tests across 8 files
- Preserved team smoke was resumed to completion on `C:\\Users\\Administrator.DEV\\AppData\\Local\\Temp\\ralph-smoke-8Cv7Ts\\team`:
- `status` shows 8/8 complete with a completed team runtime session
- `npm run build` passed
- `npm test` passed with 25 tests across 5 files

## Current Phase

Redesign complete / optional hardening only

## Next Concrete Tasks

1. Add an adversarial smoke case that fakes or omits verifier evidence, so the verifier and post-merge verifier stay locked in by end-to-end coverage.
2. Decide whether `run` should enforce a startup quality gate on manually edited or legacy `feature_list.json` files.
3. Clean up or formalize the remaining redesign scaffolding at the repository root.

## Relevant Files

- `src/core/harness-runner.ts`
- `src/core/runtime-state.ts`
- `src/core/ralph-paths.ts`
- `src/core/feature-quality-gates.ts`
- `src/core/verification.ts`
- `src/commands/run.ts`
- `src/commands/init.ts`
- `src/commands/optimize.ts`
- `src/commands/status.ts`
- `src/team/team-orchestrator.ts`
- `src/team/worktree-manager.ts`
- `prompts/initializer.md`
- `prompts/optimizer.md`
- `prompts/implementer.md`
- `prompts/evaluator.md`
- `prompts/feature-planner.md`
- `tests/unit/feature-quality-gates.test.ts`
- `tests/unit/commands/init.test.ts`
- `tests/unit/commands/optimize.test.ts`
- `tests/unit/harness-runner.test.ts`
- `tests/unit/runtime-state.test.ts`
- `tests/unit/ralph-paths.test.ts`
- `tests/unit/commands/status.test.ts`
- `tests/unit/worktree-manager.test.ts`

## Resume Notes

- Do not reset the git worktree; the repo is intentionally dirty from the redesign.
- Prefer durable framework changes over prompt-only tuning.
- Keep full backlog visibility; do not reintroduce filtered feature views.
- The Phase 4 smoke already proved the sequential todo flow end to end; do not re-open earlier “todo smoke rerun” work unless a later change breaks it.
- The smoke rerun already exposed two important framework fixes: runtime-aware status and per-attempt worktree naming.
- The Phase 4 smoke exposed three more important framework fixes: ephemeral build output cleanup, `init` stash restoration for `prd.md`, and abbreviated commit SHA acceptance.
- Phase 3 now rejects missing traceability, missing build/test coverage, weak unit/integration/E2E signals, and oversized `related_files` lists during `init` and `optimize` without blocking focused backend CRUD helper stories.
- The live team smoke exposed two more critical framework fixes: worktree-local prompt resolution and Claude settings isolation for non-interactive phases.
- The redesign goal is met; any remaining work is polish, automation, or additional adversarial coverage rather than architectural redesign.
