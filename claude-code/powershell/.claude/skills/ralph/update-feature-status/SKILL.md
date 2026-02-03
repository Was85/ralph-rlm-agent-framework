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

### PowerShell

```powershell
./.claude/skills/ralph/update-feature-status/update-feature-status.ps1 -FeatureId F042 -Status in_progress [-Path feature_list.json]
```

### Inline (PowerShell)

```powershell
$data = Get-Content feature_list.json -Raw | ConvertFrom-Json
($data.features | Where-Object { $_.id -eq "F042" }).status = "in_progress"
$data | ConvertTo-Json -Depth 10 | Set-Content feature_list.json -Encoding UTF8
```

## Rules

- Validate that the status is one of the four allowed values.
- If the feature is already in the desired status, succeed silently (idempotent).
- Also update the `stats` object to keep counts accurate.
- If updating to `complete`, clear `last_error` to null.
