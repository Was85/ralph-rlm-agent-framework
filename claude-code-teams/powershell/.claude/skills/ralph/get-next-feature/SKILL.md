---
name: ralph-get-next-feature
description: Select the next feature to implement from feature_list.json based on priority rules (in_progress first, then first pending).
user-invocable: false
---

# Skill: get-next-feature

> Select the next feature to implement from `feature_list.json`.

## Purpose

Find the next feature the Ralph Implementer should work on, based on priority rules.

## Priority Rules

1. If any feature has `status: "in_progress"`, select it (retry scenario)
2. Otherwise, select the first feature with `status: "pending"`
3. If no features match either rule, return nothing (all done or all blocked)

## Input

- Path to `feature_list.json` (default: `./feature_list.json`)

## Output

JSON object of the selected feature:

```json
{
  "id": "F042",
  "description": "Validate email format on registration",
  "acceptance_criteria": ["Email regex rejects invalid formats", "Valid emails pass through"],
  "status": "pending",
  "attempts": 0,
  "last_error": null,
  "notes": "",
  "related_files": ["src/validators/"]
}
```

If no features are available, output:

```json
{ "result": "ALL_COMPLETE" }
```

## Usage

### PowerShell

```powershell
./.claude/skills/ralph/get-next-feature/get-next-feature.ps1 [-Path feature_list.json]
```

### Inline (PowerShell)

```powershell
$data = Get-Content feature_list.json -Raw | ConvertFrom-Json

# Find in_progress feature
$data.features | Where-Object { $_.status -eq "in_progress" } | ConvertTo-Json -Depth 10

# Or first pending feature
$data.features | Where-Object { $_.status -eq "pending" } | Select-Object -First 1 | ConvertTo-Json -Depth 10
```

## Rules

- NEVER read the entire `feature_list.json` if it's large. Use targeted jq queries.
- Always check for `in_progress` first (handles retry after failure).
- Return the full feature object so the implementer has all context.
