# 🚀 Quick Start Guide (Copilot CLI - PowerShell Edition)

Get your first Ralph Loop project running with GitHub Copilot CLI in 5 minutes.

---

## Prerequisites

- PowerShell 7+ installed
- GitHub Copilot subscription

### Check PowerShell Version

```powershell
$PSVersionTable.PSVersion
# Should show 7.x.x
```

If not installed:
```powershell
winget install Microsoft.PowerShell
```

---

## Step 1: Install Copilot CLI (1 minute)

```powershell
# Install the CLI
npm install -g @github/copilot

# Authenticate with GitHub
copilot
# Follow the prompts to log in
```

---

## Step 2: Setup Project (1 minute)

```powershell
# Copy framework to your project folder
Copy-Item -Recurse copilot-cli-pwsh\* my-awesome-project\
Set-Location my-awesome-project

# Initialize git (required for safety)
git init
git add .
git commit -m "Initial commit with Ralph framework"
```

---

## Step 3: Write Your Requirements (2 minutes)

Copy and edit the PRD template:

```powershell
Copy-Item templates\prd.md prd.md
notepad prd.md
```

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

## Step 4: Run! (1 minute)

```powershell
.\ralph.ps1 auto
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
║  GitHub Copilot CLI Edition (PowerShell)                     ║
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

## Common Commands

| Command | What It Does |
|---------|--------------|
| `.\ralph.ps1 auto` | Run everything automatically |
| `.\ralph.ps1 init` | Just create features from PRD |
| `.\ralph.ps1 validate` | Just validate coverage |
| `.\ralph.ps1 run` | Just implement features |
| `.\ralph.ps1 status` | Show current state |
| `.\ralph.ps1 help` | Show all options |

---

## PowerShell-Specific Options

```powershell
# Run with more iterations
.\ralph.ps1 run -MaxIterations 100
.\ralph.ps1 run -m 100

# Run with all tools enabled (faster, less safe)
.\ralph.ps1 run -AllowAllTools

# Check status
.\ralph.ps1 status
```

---

## Tips

1. **Run from pwsh, not powershell** — This requires PowerShell 7+
2. **Better PRD = Better results** — Spend time on your requirements
3. **Include error cases** — "When X fails, show Y message"
4. **Check status** — Use `.\ralph.ps1 status` to see progress
5. **Git is your friend** — All progress is committed, easy to rollback

---

## Need Help?

- Run `.\ralph.ps1 help` for command reference
- Check `README.md` for full documentation
- Check `copilot-progress.txt` for detailed iteration logs
- Check `examples\pharmacy-bot\` for a complete example

---

Happy vibe coding! 🎸
