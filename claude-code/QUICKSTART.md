# 🚀 Quick Start Guide

Get your first Ralph Loop project running in 5 minutes.

---

## Step 1: Setup

Choose either **PowerShell** (Windows / cross-platform) or **Shell** (macOS / Linux).

### PowerShell

```powershell
# Copy framework to your project folder
Copy-Item -Recurse powershell\* my-awesome-project\
cd my-awesome-project

# Initialize git (required for safety)
git init
git add .
git commit -m "Initial commit with Ralph framework"
```

### Shell (bash)

```bash
# Copy framework to your project folder
cp -r shell/* my-awesome-project/
cd my-awesome-project

# Make the script executable
chmod +x ralph.sh

# Initialize git (required for safety)
git init
git add .
git commit -m "Initial commit with Ralph framework"
```

---

## Step 2: Write Your Requirements (2 minutes)

Copy and edit the PRD template:

```bash
cp templates/prd.md prd.md
```

Open `prd.md` and replace the template content with YOUR project requirements.

**Minimum viable PRD:**

```markdown
# Product Requirements Document

## Project Overview
**Project Name:** My Todo App
**Tech Stack:** Node.js, Express, SQLite

## Functional Requirements
- Users can create todos with a title and description
- Users can mark todos as complete
- Users can delete todos
- Users can list all todos

## Non-Functional Requirements  
- API response time under 200ms
- Input validation on all fields
```

---

## Step 3: Run!

### PowerShell
```powershell
.\ralph.ps1 auto
```

### Shell
```bash
./ralph.sh auto
```

That's it! Ralph will:

1. **Initialize** — Convert your PRD to features
2. **Validate** — Ensure all requirements are covered
3. **Implement** — Build each feature, retrying on failures

---

## What to Expect

```
╔══════════════════════════════════════════════════════════════╗
║  RALPH LOOP FRAMEWORK v2.0                                   ║
║  Based on Geoffrey Huntley's Ralph Wiggum technique          ║
╚══════════════════════════════════════════════════════════════╝

Running all phases automatically...

┌──────────────────────────────────────────────────────────────┐
│  PHASE 1: INITIALIZE                                         │
└──────────────────────────────────────────────────────────────┘
[✓] Created 45 features in feature_list.json

┌──────────────────────────────────────────────────────────────┐
│  PHASE 2: VALIDATE PRD COVERAGE                              │
└──────────────────────────────────────────────────────────────┘
━━━ Validation Iteration 1 of 10 ━━━
[✓] Validation complete! Coverage: 98%

┌──────────────────────────────────────────────────────────────┐
│  PHASE 3: IMPLEMENT FEATURES (RALPH LOOP)                    │
└──────────────────────────────────────────────────────────────┘
━━━ Implementation Iteration 1 of 50 ━━━
Working on F001: Project scaffolding...
```

---

## Check Progress Anytime

```bash
./ralph.sh status       # Shell
.\ralph.ps1 status      # PowerShell
```

Output:
```
PROJECT STATUS

[✓] prd.md exists (45 lines)
[✓] feature_list.json exists

  Features:
    Total:       45
    Complete:    12
    In Progress: 1
    Pending:     32
    Blocked:     0

  Progress: 26%

[✓] validation-state.json exists
    Coverage: 98%
    Status:   complete

NEXT ACTION
  → Run: ./ralph.sh run
```

---

## Common Commands

| Shell | PowerShell | What It Does |
|-------|------------|--------------|
| `./ralph.sh auto` | `.\ralph.ps1 auto` | Run everything automatically |
| `./ralph.sh init` | `.\ralph.ps1 init` | Just create features from PRD |
| `./ralph.sh validate` | `.\ralph.ps1 validate` | Just validate coverage |
| `./ralph.sh run` | `.\ralph.ps1 run` | Just implement features |
| `./ralph.sh status` | `.\ralph.ps1 status` | Show current state |
| `./ralph.sh help` | `.\ralph.ps1 help` | Show all options |

---

## Tips

1. **Better PRD = Better results** — Spend time on your requirements
2. **Include error cases** — "When X fails, show Y message"
3. **Don't forget NFRs** — Performance, security, logging
4. **Check status** — Use `./ralph.sh status` to see progress
5. **Git is your friend** — All progress is committed, easy to rollback

---

## Need Help?

- Run `./ralph.sh help` or `.\ralph.ps1 help` for command reference
- Check `README.md` for full documentation
- Check `claude-progress.txt` for detailed iteration logs
- Check `examples/pharmacy-bot/` for a complete example

---

Happy vibe coding! 🎸
