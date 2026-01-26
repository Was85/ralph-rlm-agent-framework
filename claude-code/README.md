# Ralph-RLM-Framework v2.0

An autonomous AI development framework based on [Geoffrey Huntley's Ralph Wiggum technique](https://ghuntley.com/ralph/) — iterative coding where failures drive improvement.

**What's new in v2.0:** Added a **Validation Phase** that ensures your PRD requirements are fully covered by features before implementation begins.

---

## Quick Start

```bash
# 1. Copy framework to your project
cp -r ralph-framework/* your-project/
cd your-project
chmod +x ralph.sh
git init  # if not already a repo

# 2. Write your requirements
cp templates/prd.md prd.md
vim prd.md  # Edit with your requirements

# 3. Run everything
./ralph.sh auto

# 4. Go make coffee ☕
```

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        RALPH-RLM FRAMEWORK v2.0                        │
└─────────────────────────────────────────────────────────────────────────┘

     YOU WRITE                PHASE 1                 PHASE 2
    ┌─────────┐            ┌───────────┐          ┌────────────┐
    │         │            │           │          │            │
    │ prd.md  │ ────────▶  │   INIT    │ ───────▶ │  VALIDATE  │
    │         │            │           │          │   (loop)   │
    └─────────┘            └───────────┘          └─────┬──────┘
                                 │                      │
                                 │                      │ coverage ≥ 95%?
                                 ▼                      │
                          feature_list.json             │
                                                        ▼
                                                 ┌────────────┐
                                                 │            │
                                                 │ IMPLEMENT  │
                                                 │   (loop)   │
                                                 │            │
                                                 └─────┬──────┘
                                                       │
                                                       ▼
                                                  PHASE 3
                                               Working Software!
```

---

## The Three Phases

### Phase 1: Initialize (`./ralph.sh init`)

- **Input:** Your `prd.md` (requirements)
- **Output:** `feature_list.json` with 50-200 atomic features
- **Runs:** Once

The Initializer Agent reads your PRD and decomposes it into small, testable features.

### Phase 2: Validate (`./ralph.sh validate`)

- **Input:** `prd.md` + `feature_list.json`
- **Output:** Updated `feature_list.json` with any missing features
- **Runs:** In a loop until coverage ≥ 95%

The Validator Agent cross-checks your PRD against the features to find gaps. If requirements are missing, it adds features automatically. This prevents requirements from getting lost during decomposition.

### Phase 3: Implement (`./ralph.sh run`)

- **Input:** `feature_list.json`
- **Output:** Working code!
- **Runs:** In a loop until all features complete (or blocked)

The Implementer Agent works on one feature at a time. If tests fail, it logs the error and exits. The loop restarts with a fresh context, sees the failure, and tries a different approach.

---

## Commands

```bash
./ralph.sh init       # Phase 1: Create features from PRD
./ralph.sh validate   # Phase 2: Validate PRD coverage (loops)
./ralph.sh run        # Phase 3: Implement features (loops)
./ralph.sh auto       # Run all phases automatically
./ralph.sh status     # Show current project state
./ralph.sh help       # Show help
```

---

## Project Structure

After setup, your project will have:

```
your-project/
├── ralph.sh                    # Main entry point
├── prd.md                      # YOUR requirements (you write this)
├── feature_list.json           # Generated features (auto-created)
├── validation-state.json       # Validation tracking (auto-created)
├── claude-progress.txt         # Detailed iteration log (auto-created)
├── prompts/
│   ├── initializer.md          # Phase 1 instructions
│   ├── validator.md            # Phase 2 instructions
│   └── implementer.md          # Phase 3 instructions
├── templates/
│   ├── prd.md                  # PRD template (copy this)
│   ├── feature_list.json       # Feature template
│   ├── validation-state.json   # Validation template
│   └── claude-progress.txt     # Progress template
├── examples/
│   └── pharmacy-bot/           # Example project
│       ├── prd.md
│       └── feature_list.json
├── CLAUDE.md                   # Framework documentation
└── README.md                   # This file
```

---

## Writing a Good PRD

The quality of your output depends on the quality of your input. A good PRD includes:

| Section | Why It Matters |
|---------|----------------|
| Functional Requirements | What the system must DO |
| Non-Functional Requirements | Performance, security, scalability (often missed!) |
| Error Handling | What happens when things fail |
| Integrations | External APIs and systems |
| Edge Cases | Empty inputs, max values, special characters |

**Tip:** Use the template at `templates/prd.md` as a starting point.

**Common mistakes:**
- ❌ "System should be fast" → ✅ "Response time < 200ms"
- ❌ "Handle errors gracefully" → ✅ "Show specific error message for timeout"
- ❌ Forgetting security requirements entirely

---

## The Ralph Philosophy

> "Ralph is a Bash loop." — Geoffrey Huntley

The key insight: **failures are data**. Each failed iteration:

1. Logs the exact error
2. Records what was tried
3. Exits cleanly

The next iteration:

1. Sees the failure history
2. Tries a DIFFERENT approach
3. Eventually converges on a solution

> "The technique is deterministically bad in an undeterministic world.
> It's better to fail predictably than succeed unpredictably."

---

## Feature Lifecycle

```
                    ┌──────────────────────────────────────┐
                    │         feature_list.json            │
                    └──────────────────────────────────────┘

     pending ──────────────▶ in_progress ──────────────▶ complete
                                  │
                                  │ (on test failure)
                                  ▼
                             in_progress
                            (attempt N+1)
                                  │
                                  │ (after 5 failures)
                                  ▼
                              blocked
                         (needs human help)
```

---

## Validation Phase Deep Dive

The validation phase prevents a common problem: **requirements getting lost** when converting a PRD to features.

### How It Works

1. Validator extracts ALL requirements from PRD (functional, NFR, edge cases)
2. Maps each requirement to existing features
3. Identifies gaps (requirements with no matching feature)
4. Auto-generates features for gaps
5. Loops until coverage ≥ 95%

### Example Gap Detection

```
PRD says: "System must handle 1000 concurrent users"
Features: [F001: Login, F002: Dashboard, F003: Query...]

Validator: "No feature covers the concurrency requirement!"
Action: Adds F050: "System handles 1000 concurrent user sessions"
```

### Validation State

```json
{
  "coverage_percent": 95,
  "iteration": 3,
  "status": "complete",
  "requirements_found": 28,
  "requirements_covered": 27,
  "gaps": [],
  "features_added": ["F025", "F026", "F027"]
}
```

---

## Configuration

### Environment Variables

```bash
# Validation phase
MAX_VALIDATE_ITERATIONS=10     # Default: 10
COVERAGE_THRESHOLD=95          # Default: 95%

# Implementation phase
MAX_IMPLEMENT_ITERATIONS=50    # Default: 50
SLEEP_BETWEEN=2                # Default: 2 seconds

# Example: More iterations, higher coverage
MAX_IMPLEMENT_ITERATIONS=100 COVERAGE_THRESHOLD=100 ./ralph.sh auto
```

### feature_list.json Config

```json
{
  "config": {
    "max_attempts_per_feature": 5,
    "test_command": "dotnet test",
    "build_command": "dotnet build"
  }
}
```

---

## Completion Signals

| Signal | Where | Meaning |
|--------|-------|---------|
| `"status": "complete"` | validation-state.json | Validation done (coverage met) |
| `ALL_FEATURES_COMPLETE` | claude-progress.txt | All features implemented |
| `BLOCKED_NEEDS_HUMAN` | claude-progress.txt | Feature stuck, needs help |

---

## Troubleshooting

### "prd.md not found"
Create your requirements file:
```bash
cp templates/prd.md prd.md
vim prd.md
```

### "feature_list.json not found"
Run initialization first:
```bash
./ralph.sh init
```

### Validation stuck at low coverage
Your PRD may have ambiguous requirements. Check `validation-state.json` for gaps and clarify your PRD.

### Feature keeps failing after 5 attempts
The feature is marked "blocked". Check `claude-progress.txt` for the error history, fix manually, then reset:
```bash
# Reset blocked feature to pending
jq '.features |= map(if .status == "blocked" then .status = "pending" | .attempts = 0 else . end)' feature_list.json > tmp.json && mv tmp.json feature_list.json
```

### Want to restart from scratch
```bash
rm feature_list.json validation-state.json claude-progress.txt
./ralph.sh auto
```

---

## Safety Features

- **Git required:** Always run in a git repo for rollback
- **No destructive commands:** Agent can't run `rm`, `sudo`, etc.
- **Max iterations:** Loops stop after configured limit
- **Blocked status:** Features that fail 5x stop trying

---

## Requirements

- [Claude Code CLI](https://www.npmjs.com/package/@anthropic-ai/claude-code) (`npm install -g @anthropic-ai/claude-code`)
- Git
- Bash shell
- jq (for status command)

---

## Credits

- Original technique: [Geoffrey Huntley](https://ghuntley.com/ralph/)
- Inspired by: [Anthropic's long-running agent guide](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

---

## License

MIT
