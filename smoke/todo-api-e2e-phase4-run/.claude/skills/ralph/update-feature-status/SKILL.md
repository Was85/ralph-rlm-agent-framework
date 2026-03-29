---
name: ralph-update-feature-status
description: Update the status of a feature in feature_list.json (pending, in_progress, complete, or blocked) and recalculate stats.
user-invocable: false
---

# Skill: update-feature-status

> Update the status of a feature in `feature_list.json`.

## Purpose

Change a feature's status during the Ralph loop. Used by the Implementer to mark features as in_progress, complete, or blocked.

## Allowed Statuses

| Status | Meaning |
|--------|---------|
| `pending` | Not yet started |
| `in_progress` | Currently being worked on (or retrying after failure) |
| `complete` | Successfully implemented and tests pass |
| `blocked` | Failed after max attempts, needs human intervention |

## Input

- **Feature ID**: e.g., `F001`, `F042`
- **New Status**: One of `pending`, `in_progress`, `complete`, `blocked`
- **Path**: Path to `feature_list.json` (default: `./feature_list.json`)

## Output

Confirmation message:

```
Updated F042 status from "pending" to "in_progress"
```

## Usage

```bash
ralph skill update-feature-status --id F042 --status in_progress
```

## Rules

- Validate that the status is one of the four allowed values.
- If the feature is already in the desired status, succeed silently (idempotent).
- Also update the `stats` object to keep counts accurate.
- If updating to `complete`, clear `last_error` to null.
