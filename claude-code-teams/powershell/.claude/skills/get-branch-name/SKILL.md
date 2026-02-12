---
name: get-branch-name
description: Generate standardized git branch names using feature/kebab-case-name convention from the project PRD.
user-invocable: false
---

# Skill: get-branch-name

> Generate or extract a git branch name for the current feature work.

## Purpose

Standardize branch naming across Ralph projects for consistent git workflow.

## Branch Naming Convention

```
feature/{kebab-case-project-or-feature-name}
```

### Examples

| Project/Feature | Branch Name |
|----------------|-------------|
| Calculator Web API | `feature/calculator-web-api` |
| User Authentication | `feature/user-authentication` |
| Pharmacy Slack Bot | `feature/pharmacy-slack-bot` |
| Bug Fix: Login Timeout | `bugfix/login-timeout` |

### Rules

1. Use `feature/` prefix for new features (default)
2. Use `bugfix/` prefix for bug fixes
3. Use `refactor/` prefix for refactoring work
4. Convert project name to **kebab-case** (lowercase, hyphens)
5. Keep branch names under 50 characters
6. No special characters except hyphens

## How to Determine Branch Name

1. Read the `## Project Overview` section of `prd.md`
2. Extract the **Project Name** field
3. Convert to kebab-case
4. Prefix with `feature/` (or appropriate prefix)

### PowerShell Example

```powershell
$line = Get-Content prd.md | Where-Object { $_ -match "Project Name:" } | Select-Object -First 1
$projectName = ($line -replace '.*:\s*', '').Trim().ToLower() -replace '\s+', '-' -replace '[^a-z0-9-]', ''
$branchName = "feature/$projectName"
Write-Output $branchName
```

## Git Workflow Integration

```powershell
# Create and switch to feature branch
$branchName = # ... extract as above
git checkout -b $branchName

# After Ralph completes, push and create PR
git push -u origin $branchName
```
