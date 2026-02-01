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

### Bash

```bash
./skills/ralph/increment-feature-attempts/increment-feature-attempts.sh F042 [feature_list.json]
./skills/ralph/increment-feature-attempts/increment-feature-attempts.sh F042 feature_list.json --error "TypeError: undefined is not a function"
```

### PowerShell

```powershell
./skills/ralph/increment-feature-attempts/increment-feature-attempts.ps1 -FeatureId F042
./skills/ralph/increment-feature-attempts/increment-feature-attempts.ps1 -FeatureId F042 -ErrorMessage "Build failed"
```

### Inline (jq)

```bash
jq --arg id "F042" --arg err "Build failed" \
  '(.features[] | select(.id == $id)) |= (.attempts += 1 | .last_error = $err)' \
  feature_list.json > tmp.json && mv tmp.json feature_list.json
```

## Rules

- Increment `attempts` by exactly 1 each call.
- If `--error` / `-ErrorMessage` is provided, update `last_error` with the message.
- The script reports the new value and the max_attempts from config for context.
- The script does NOT auto-block -- the implementer agent decides when to block based on max_attempts.
