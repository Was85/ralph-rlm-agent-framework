# Quick Start Guide (Teams Edition)

Get your first Ralph Teams project running in 5 minutes.

---

## Step 1: Setup

```powershell
# Copy framework to your project folder
Copy-Item -Recurse powershell\* my-awesome-project\
cd my-awesome-project

# Initialize git (required for safety)
git init
git add .
git commit -m "Initial commit with Ralph Teams framework"
```

---

## Step 2: Write Your Requirements (2 minutes)

Copy and edit the PRD template:

```powershell
Copy-Item templates\prd.md prd.md
```

Open `prd.md` and replace the template content with YOUR project requirements.

**Or use the PRD assistant:**

```powershell
.\ralph-teams.ps1 author
```

---

## Step 3: Run!

```powershell
.\ralph-teams.ps1 auto
```

That's it! Ralph Teams will:

1. **Initialize** -- Convert your PRD to features
2. **Validate** -- Ensure all requirements are covered
3. **Team Implement** -- Build features in parallel with agent teams

---

## What to Expect

```
==================================================================
||  RALPH-RLM FRAMEWORK v2.0 TEAMS                             ||
||  Claude Code CLI + Agent Teams (PowerShell)                  ||
==================================================================

Running all phases automatically...

  Phase 1: Initialize (PRD -> features)
  Phase 2: Validate (ensure coverage)
  Phase 3: Team Implement (3 parallel implementers)
           + per-feature code review

----------------------------------------------------------------
  PHASE 3: IMPLEMENT FEATURES (AGENT TEAMS)
----------------------------------------------------------------

[i] 45 feature(s) remaining to implement
[i] Launching team lead agent...
[i] The team lead will spawn 3 implementer teammates
[i] A reviewer teammate will review each feature before marking it complete
```

---

## Customize Team Size

```powershell
# More implementers = faster (but more API calls)
.\ralph-teams.ps1 auto -Teammates 5

# Fewer implementers = slower but cheaper
.\ralph-teams.ps1 auto -Teammates 2

# Skip review for speed (less safe)
.\ralph-teams.ps1 auto -SkipReview
```

---

## Check Progress Anytime

```powershell
.\ralph-teams.ps1 status
```

Output:
```
PROJECT STATUS

[+] prd.md exists (45 lines)
[+] feature_list.json exists

  Features:
    Total:       45
    Complete:    12
    In Progress: 3
    Pending:     30
    Blocked:     0

  Progress: 26%

  Claimed by teammates: 3
    F013: implementer-1 (in_progress)
    F014: implementer-2 (in_progress)
    F015: implementer-3 (in_progress)

NEXT ACTION
  -> Run: .\ralph-teams.ps1 run
```

---

## Common Commands

| Command | What It Does |
|---------|--------------|
| `.\ralph-teams.ps1 auto` | Run everything automatically |
| `.\ralph-teams.ps1 auto -Teammates 5` | Run with 5 parallel implementers |
| `.\ralph-teams.ps1 run -SkipReview` | Implement without code review |
| `.\ralph-teams.ps1 init` | Just create features from PRD |
| `.\ralph-teams.ps1 validate` | Just validate coverage |
| `.\ralph-teams.ps1 run` | Just implement features (team) |
| `.\ralph-teams.ps1 status` | Show current state |
| `.\ralph-teams.ps1 help` | Show all options |

---

## Tips

1. **Better PRD = Better results** -- Spend time on your requirements
2. **Independent features work best** -- Each feature should touch different files
3. **3 teammates is a good default** -- More isn't always faster (diminishing returns)
4. **Review catches bugs** -- Don't skip review unless you're prototyping
5. **Git is your friend** -- All progress is committed, easy to rollback
6. **Check status** -- Use `.\ralph-teams.ps1 status` to see progress and claimed features

---

## Need Help?

- Run `.\ralph-teams.ps1 help` for command reference
- Check `README.md` for full documentation
- Check `claude-progress.txt` for detailed iteration logs
- Check `examples/pharmacy-bot/` for a complete example
- Sequential variant: `../claude-code/`
