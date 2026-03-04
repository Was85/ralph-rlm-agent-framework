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

```bash
ralph skill increment-feature-attempts --id F042
ralph skill increment-feature-attempts --id F042 --error "Build failed"
```

## Rules

- Increment `attempts` by exactly 1 each call.
- If `--error` is provided, update `last_error` with the message.
- The command reports the new value and the max_attempts from config for context.
- The command does NOT auto-block -- the implementer agent decides when to block based on max_attempts.
