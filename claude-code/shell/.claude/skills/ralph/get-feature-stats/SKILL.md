---
name: ralph-get-feature-stats
description: Get a compact summary of project status and feature counts from feature_list.json.
user-invocable: false
---

# Skill: get-feature-stats

> Get a compact summary of project status and feature counts.

## Purpose

Quickly check project progress without reading the entire `feature_list.json`. Returns project metadata and feature counts by status.

## Input

- **Path**: Path to `feature_list.json` (default: `./feature_list.json`)

## Output

Compact JSON:

```json
{
  "project": "My Project",
  "config": {
    "test_command": "dotnet test",
    "build_command": "dotnet build",
    "max_attempts_per_feature": 5
  },
  "stats": {
    "total_features": 85,
    "complete": 42,
    "in_progress": 1,
    "pending": 40,
    "blocked": 2
  }
}
```

## Usage

### Bash

```bash
./skills/ralph/get-feature-stats/get-feature-stats.sh [feature_list.json]
```

### PowerShell

```powershell
./skills/ralph/get-feature-stats/get-feature-stats.ps1 [-Path feature_list.json]
```

### Inline (jq)

```bash
jq '{project: .project, config: .config, stats: .stats}' feature_list.json
```

## Rules

- This is a read-only operation. Never modify `feature_list.json`.
- Use this at the start of every iteration (Orient phase) to understand project state.
