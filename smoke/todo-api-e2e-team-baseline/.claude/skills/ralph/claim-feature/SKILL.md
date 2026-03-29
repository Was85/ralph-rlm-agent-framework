---
name: ralph-claim-feature
description: Atomically claim a feature for a teammate. Uses file locking to prevent two teammates from claiming the same feature. Teams variant only.
user-invocable: false
---

# Skill: claim-feature

> Atomically claim the next available feature for a teammate.

## Purpose

In team mode, multiple implementer teammates work in parallel. This command ensures that no two teammates claim the same feature by using file locking around the read-modify-write operation.

## Priority Rules

1. If this teammate already has an `in_progress` feature (`claimed_by` matches), return it (retry scenario)
2. Otherwise, find the first `pending` feature with no `claimed_by` value
3. Set `status` to `in_progress`, set `claimed_by` to the teammate name
4. Recalculate stats, write file, return claimed feature JSON

## Input

- **TeammateName** (required): Name of the teammate claiming the feature (e.g., `"implementer-1"`)
- **Path**: Path to `feature_list.json` (default: `./feature_list.json`)

## Output

JSON object of the claimed feature:

```json
{
  "id": "F042",
  "description": "Validate email format on registration",
  "status": "in_progress",
  "claimed_by": "implementer-1",
  ...
}
```

If no features are available to claim:

```json
{ "result": "ALL_CLAIMED" }
```

## Usage

```bash
ralph skill claim-feature --teammate "implementer-1"
```

## Schema Extension

This command adds one optional field to each feature:

```json
{ "claimed_by": "implementer-1" }
```

## Rules

- ALWAYS use this command to claim features in team mode (never set status manually)
- File locking prevents concurrent corruption
- `claimed_by` persists across session crashes, preventing re-claiming by other teammates
