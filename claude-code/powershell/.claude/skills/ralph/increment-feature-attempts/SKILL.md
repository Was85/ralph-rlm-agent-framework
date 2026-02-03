---
name: ralph-increment-feature-attempts
description: Increment the attempts counter for a feature after a failed implementation attempt. Optionally sets the last_error message.
user-invocable: false
---

# Skill: increment-feature-attempts

> Increment the attempts counter for a feature after a failed verification.

## Purpose

Track how many times the Ralph Implementer has tried to implement a feature. After reaching `max_attempts` (default: 5), the feature should be marked as `blocked`.

## Input

- **Feature ID**: e.g., `F001`, `F042`
- **Error Message** (optional): The error from the failed attempt, stored in `last_error`
- **Path**: Path to `feature_list.json` (default: `./feature_list.json`)

## Output

```
Updated attempts for F042 from 2 to 3 (max: 5)
```

## Usage

### PowerShell

```powershell
./.claude/skills/ralph/increment-feature-attempts/increment-feature-attempts.ps1 -FeatureId F042
./.claude/skills/ralph/increment-feature-attempts/increment-feature-attempts.ps1 -FeatureId F042 -ErrorMessage "Build failed"
```

### Inline (PowerShell)

```powershell
$data = Get-Content feature_list.json -Raw | ConvertFrom-Json
$feature = $data.features | Where-Object { $_.id -eq "F042" }
$feature.attempts = $feature.attempts + 1
$feature.last_error = "Build failed"
$data | ConvertTo-Json -Depth 10 | Set-Content feature_list.json -Encoding UTF8
```

## Rules

- Increment `attempts` by exactly 1 each call.
- If `--error` / `-ErrorMessage` is provided, update `last_error` with the message.
- The script reports the new value and the max_attempts from config for context.
- The script does NOT auto-block -- the implementer agent decides when to block based on max_attempts.
