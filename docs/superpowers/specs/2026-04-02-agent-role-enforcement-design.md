# Agent Role Enforcement — Design Spec

**Date:** 2026-04-02
**Status:** Draft
**Scope:** P0 (Hook Pipeline) + P1 (Reviewer Lockout) + P2 (Session Isolation)

## Problem

Ralph enforces role separation via prompt instructions ("do not write code", "do not edit feature_list.json"). Agents can ignore these instructions. The framework needs code-level enforcement so agents **cannot** violate their role boundaries, not just **should not**.

## Solution

Use Claude Code's native `PreToolUse` hook system to intercept `Write` and `Edit` tool calls before execution. A guard script checks the target file path against the current role's allowed writes. Violations are blocked with an explanation message sent back to the agent.

## Architecture

### Components

1. **`ralph-guard.js`** — Standalone Node.js script (~50 lines), bundled with Ralph in `scaffold-assets/`. Copied to `.ralph/guard.js` at scaffold time and before each run.

2. **`src/core/agent-guard.ts`** — TypeScript module that:
   - Generates `.ralph/guard-config.json` with role permissions before each phase
   - Writes `.claude/settings.local.json` with the PreToolUse hook
   - Restores/removes settings after phase completes
   - Provides `withGuard(role, allowedPaths, fn)` wrapper

3. **Integration points** — `harness-runner.ts`, `init.ts`, `validate.ts`, `optimize.ts` wrap their `runner.invoke()` calls with the guard.

### Guard Script Contract

**Input** (stdin from Claude Code):
```json
{
  "tool_name": "Write",
  "tool_input": { "file_path": "/abs/path/to/file.ts", "content": "..." }
}
```

**Config** (read from `.ralph/guard-config.json`):
```json
{
  "role": "planner",
  "allowed_write_globs": [".ralph/features/F001/contract.json"],
  "blocked_bash_patterns": ["rm -rf", "git push", "git reset --hard"]
}
```

**Decision logic:**
- Tool is `Write` or `Edit` → check `file_path` against `allowed_write_globs`
  - Match → allow (exit 0, no output)
  - No match → block (exit 2, stderr: "Blocked: planner cannot write to src/index.ts")
- Tool is `Bash` → check `command` against `blocked_bash_patterns`
  - Match → block (exit 2, stderr: "Blocked: {pattern} not allowed for {role}")
  - No match → allow
- Any other tool → allow

### Role Permissions

| Role | Allowed Write Globs | Blocked Bash | Git Commit |
|------|---------------------|--------------|------------|
| initializer | `feature_list.json`, `claude-progress.txt` | `git commit`, `git push` | No |
| validator | `validation-state.json`, `feature_list.json` | `git commit`, `git push` | No |
| optimizer | `feature_list.json` | `git commit`, `git push` | No |
| planner | `.ralph/features/{id}/contract.json` | `git commit`, `git push` | No |
| evaluator | `.ralph/features/{id}/contract-review.json` | `git commit`, `git push` | No |
| implementer | `**` (all files) | `git push`, `git reset --hard` | Yes |
| verifier | `.ralph/features/{id}/verification-report.json` | `git commit`, `git push` | No |

Notes:
- Implementer allows all writes because the existing post-hoc scope validation in `harness-runner.ts` already catches drift (file scope check, commit count check, dirty file check). Adding a hook here would require reading the contract at guard time, which adds complexity for no new safety.
- All roles block `git push` — Ralph never pushes.
- All non-implementer roles block `git commit` — only the implementer creates commits.

### Settings Swap Flow

```
Before phase:
  1. Save existing .claude/settings.local.json (if any) to .ralph/.settings-backup.json
  2. Write .ralph/guard-config.json with role permissions
  3. Write .claude/settings.local.json with PreToolUse hook

After phase (always, even on error):
  4. Restore .claude/settings.local.json from backup (or delete if no backup)
  5. Delete .ralph/guard-config.json
```

The settings.local.json written by Ralph:
```json
{
  "permissions": {
    "allow": [],
    "deny": []
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node .ralph/guard.js",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

### `withGuard()` API

```typescript
async function withGuard(
  cwd: string,
  role: GuardRole,
  allowedWriteGlobs: string[],
  fn: () => Promise<T>,
): Promise<T>
```

Usage in harness-runner.ts:
```typescript
const contract = await withGuard(cwd, 'planner', [paths.contractPath], () =>
  runRetryablePhase({ runner, config, cwd, prompt, ... })
);
```

Usage in init.ts:
```typescript
await withGuard(cwd, 'initializer', [featureListPath, progressPath], () =>
  runner.invoke(prompt, { ... })
);
```

### Team Mode Considerations

In team mode, each feature runs in its own git worktree. Each worktree has its own `.claude/` and `.ralph/` directories, so there's no race condition on settings files between parallel agents.

## File Changes

| File | Change |
|------|--------|
| `src/core/agent-guard.ts` | **New.** `withGuard()`, guard config generation, settings swap logic |
| `scaffold-assets/ralph-guard.js` | **New.** The hook script (~50 lines) |
| `src/core/harness-runner.ts` | Wrap planner, evaluator, implementer, verifier invocations with `withGuard()` |
| `src/commands/init.ts` | Wrap `runner.invoke()` with `withGuard('initializer', ...)` |
| `src/commands/validate.ts` | Wrap `runner.invoke()` with `withGuard('validator', ...)` |
| `src/commands/optimize.ts` | Wrap `runner.invoke()` with `withGuard('optimizer', ...)` |
| `src/commands/scaffold.ts` | Copy `ralph-guard.js` to `.ralph/guard.js` during scaffold |
| `tests/unit/agent-guard.test.ts` | **New.** Test guard decision logic and settings swap |

## Testing

1. **Unit tests for guard logic:** Given (role, tool_name, file_path) → expect allow/block
2. **Unit tests for settings swap:** Verify backup/restore, cleanup on error
3. **Integration test:** Spawn a mock runner through `withGuard()`, verify settings are written before invoke and cleaned after
4. **Smoke test coverage:** Existing smoke tests validate the full pipeline still works with guards active

## Out of Scope

- P3 (Persistent Agent Learning) — dropped, insufficient value for the complexity
- P4 (Cost Tracking) — dropped per user request
- MCP proxy or custom runner modifications — unnecessary with hook approach
- Glob matching in guard script — simple string prefix/exact match is sufficient for the file paths Ralph generates
