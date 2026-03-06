# Ralph Framework Workflow Instructions

## Overview

You are working inside the **Ralph-RLM-Framework**, an AI agent orchestrator that implements features one at a time from a `feature_list.json` file.

## Feature Lifecycle

Features go through these statuses:

| Status | Meaning |
|--------|---------|
| `pending` | Not yet started |
| `in_progress` | Currently being worked on |
| `complete` | Successfully implemented and tests pass |
| `blocked` | Failed after max attempts, needs human intervention |

## Workflow (One Feature Per Session)

### 1. Read Progress Context

Read `claude-progress.txt` for codebase patterns and learnings from previous iterations.

### 2. Identify Your Feature

If your launch prompt contains "YOUR ASSIGNED FEATURE: FXXX", that is your only task.

If not assigned, query `feature_list.json`:
- First, check for any `in_progress` feature (retry scenario)
- Then, take the first `pending` feature

### 3. Explore the Codebase

Before implementing, search for existing patterns:
- Check the feature's `related_files` if present
- Find similar implementations with `grep` or search
- Read ONE example file to understand the pattern
- Follow existing conventions

### 4. Implement (TDD)

1. Write a failing test for the behavior
2. Write the simplest code to make it pass
3. Run all tests to confirm everything passes
4. Repeat for each acceptance criterion

### 5. On Success (Tests Pass)

1. Update `feature_list.json`: set the feature status to `complete`, clear `last_error`, and recalculate stats
2. **Git commit (mandatory):**
   ```bash
   git add .
   git commit -m "feat: FXXX - description"
   ```
3. Update `claude-progress.txt` with what worked and any new patterns discovered
4. **EXIT immediately** — do not start another feature

### 6. On Failure (Tests Fail)

1. **DO NOT commit broken code**
2. Update `feature_list.json`: increment `attempts`, set `last_error` with the error message
3. Log the failure in `claude-progress.txt` with what you tried and your theory for the fix
4. **EXIT** — the framework will retry with fresh context

## Rules

### DO:
- Implement exactly ONE feature per session, then exit
- Always `git add . && git commit` when tests pass
- Search the codebase for patterns before implementing
- Use TDD (Red-Green-Refactor)
- Log failures with detailed error messages
- Try different approaches after failures

### DON'T:
- Never commit broken code
- Never implement more than one feature per session
- Never batch multiple features into one commit
- Never mark features complete without passing tests
- Never try to read the entire codebase at once
- Never repeat the same failing approach
- Never delete files unless the feature requires it

## Stats Recalculation

When updating `feature_list.json`, always recalculate the `stats` object:

```json
{
  "total": "<count of all features>",
  "complete": "<count where status is complete>",
  "in_progress": "<count where status is in_progress>",
  "pending": "<count where status is pending>",
  "blocked": "<count where status is blocked>"
}
```
