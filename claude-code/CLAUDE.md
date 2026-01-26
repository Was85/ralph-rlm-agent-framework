# CLAUDE.md - Ralph Loop Framework v2.0

This project uses the **Ralph Loop Framework v2.0** for autonomous AI development.

---

## Three-Phase Architecture

### Phase 1: Initializer Agent (First Run)
- User provides `prd.md` with requirements
- Claude analyzes and creates `feature_list.json` (50-200 atomic features)
- Does NOT write application code
- Run with: `./ralph.sh init`

### Phase 2: Validator Agent (Loops Until Coverage Met)
- Cross-checks PRD against feature_list.json
- Finds gaps (requirements without matching features)
- Auto-adds missing features
- Loops until coverage ≥ 95%
- Run with: `./ralph.sh validate`

### Phase 3: Implementer Agent (Loops Until Complete)
- Works on ONE feature at a time
- If tests fail → logs error → exits → loop restarts
- Fresh context sees failure history, tries different approach
- Repeats until all features pass
- Run with: `./ralph.sh run`

---

## What is Ralph Loop?

Ralph Loop is an iterative AI coding methodology where:

1. An AI agent works on ONE feature at a time
2. If tests fail, the agent logs the error and exits
3. A bash loop restarts the agent with fresh context
4. The agent sees previous failures and tries a different approach
5. Repeat until success (or max attempts reached)

> "Ralph is a Bash loop." — Geoffrey Huntley

---

## Project Structure

```
project/
├── ralph.sh               # Main entry point (three phases)
├── prd.md                 # Your requirements (YOU write this)
├── feature_list.json      # Features with status tracking
├── validation-state.json  # Validation coverage tracking
├── claude-progress.txt    # Iteration log with failure details
├── prompts/
│   ├── initializer.md     # Phase 1 instructions
│   ├── validator.md       # Phase 2 instructions
│   └── implementer.md     # Phase 3 instructions
└── CLAUDE.md              # This file
```

---

## Key Files

### `prd.md`
Your Product Requirements Document. Include:
- Functional requirements (what it must DO)
- Non-functional requirements (performance, security)
- Error handling scenarios
- Integration points
- Edge cases

### `feature_list.json`
Tracks all features with:
- `status`: "pending" | "in_progress" | "complete" | "blocked"
- `attempts`: Number of implementation attempts
- `last_error`: Error from most recent failed attempt
- `source_requirement`: (Optional) Which PRD requirement this covers

### `validation-state.json`
Tracks validation coverage:
- `coverage_percent`: How much of the PRD is covered
- `gaps`: Requirements that need features
- `features_added`: Features added by validator

### `claude-progress.txt`
Detailed log of each iteration:
- What was tried
- Exact error messages
- Theories about fixes
- Git commit hashes

---

## Running the Framework

```bash
# Automatic (all phases)
./ralph.sh auto

# Or step by step
./ralph.sh init       # Phase 1: PRD → features
./ralph.sh validate   # Phase 2: Ensure coverage
./ralph.sh run        # Phase 3: Implement

# Check status
./ralph.sh status
```

---

## Completion Signals

### Validation Phase
- `"status": "complete"` in validation-state.json → Coverage met, proceed to implementation
- `"status": "blocked"` → Human review needed (ambiguous requirements)

### Implementation Phase
- `ALL_FEATURES_COMPLETE` in progress file → All done, loop exits successfully
- `BLOCKED_NEEDS_HUMAN` in progress file → Feature stuck, needs human help
- Max iterations reached → Loop exits, check progress

---

## Safety

The framework allows:
- ✅ Read all files
- ✅ Write/Edit files
- ✅ Git operations
- ✅ Run tests

The framework prevents:
- ❌ Delete files (rm, rmdir)
- ❌ Network calls (curl, wget)
- ❌ Privilege escalation (sudo)

Always run in a git repository for easy rollback.

---

## Philosophy

> "The technique is deterministically bad in an undeterministic world.
> It's better to fail predictably than succeed unpredictably."
> — Geoffrey Huntley

Failures are data. Each failed attempt teaches the next iteration what NOT to do.

The Validation Phase adds an extra layer: ensuring that what we BUILD matches what was REQUESTED. No more lost requirements.
