# Ralph-RLM-Framework v2.0 (GitHub Copilot CLI - PowerShell Edition)

An autonomous AI development framework based on [Geoffrey Huntley's Ralph Wiggum technique](https://ghuntley.com/ralph/) — iterative coding where failures drive improvement.

**This edition** uses [GitHub Copilot CLI](https://github.com/features/copilot/cli) with **native PowerShell 7** (no Bash required).

---

## Prerequisites

- **PowerShell 7+** (pwsh)
- **GitHub Copilot subscription** (Pro, Pro+, Business, or Enterprise)
- **GitHub Copilot CLI** installed and authenticated
- Git

### Installing PowerShell 7

```powershell
# Windows (using winget)
winget install Microsoft.PowerShell

# Or download from: https://aka.ms/powershell
```

### Installing GitHub Copilot CLI

```powershell
# Install via npm
npm install -g @github/copilot

# Authenticate (follow the prompts)
copilot
```

---

## Quick Start

```powershell
# 1. Copy framework to your project
Copy-Item -Recurse copilot-cli-pwsh\* your-project\
Set-Location your-project

# 2. Initialize git if needed
git init

# 3. Write your requirements
Copy-Item templates\prd.md prd.md
notepad prd.md  # Edit with your requirements

# 4. Run everything
.\ralph.ps1 auto

# 5. Go make coffee ☕
```

---

## Commands

```powershell
.\ralph.ps1 init       # Phase 1: Create features from PRD
.\ralph.ps1 validate   # Phase 2: Validate PRD coverage (loops)
.\ralph.ps1 run        # Phase 3: Implement features (loops)
.\ralph.ps1 auto       # Run all phases automatically
.\ralph.ps1 status     # Show current project state
.\ralph.ps1 help       # Show help
```

---

## Options

```powershell
.\ralph.ps1 run -MaxIterations 100        # More implementation iterations
.\ralph.ps1 run -m 100                    # Short form

.\ralph.ps1 validate -CoverageThreshold 90  # Lower coverage requirement
.\ralph.ps1 validate -c 90                  # Short form

.\ralph.ps1 run -SleepBetween 5           # Longer pause between iterations
.\ralph.ps1 run -s 5                      # Short form

.\ralph.ps1 run -AllowAllTools            # Fully autonomous (less safe)
```

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────┐
│        RALPH-RLM FRAMEWORK v2.0 (Copilot CLI - PowerShell)             │
└─────────────────────────────────────────────────────────────────────────┘

     YOU WRITE                PHASE 1                 PHASE 2
    ┌─────────┐            ┌───────────┐          ┌────────────┐
    │         │            │           │          │            │
    │ prd.md  │ ────────►  │   INIT    │ ───────► │  VALIDATE  │
    │         │            │ (Copilot) │          │   (loop)   │
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

## Project Structure

```
your-project\
├── ralph.ps1                   # Main entry point (PowerShell)
├── prd.md                      # YOUR requirements (you write this)
├── feature_list.json           # Generated features (auto-created)
├── validation-state.json       # Validation tracking (auto-created)
├── copilot-progress.txt        # Detailed iteration log (auto-created)
├── prompts\
│   ├── initializer.md          # Phase 1 instructions
│   ├── validator.md            # Phase 2 instructions
│   └── implementer.md          # Phase 3 instructions
├── templates\
│   ├── prd.md                  # PRD template
│   ├── feature_list.json       # Feature template
│   ├── validation-state.json   # Validation template
│   └── copilot-progress.txt    # Progress template
└── examples\
    └── pharmacy-bot\           # Example project
```

---

## Why PowerShell?

| Bash Version | PowerShell Version |
|--------------|-------------------|
| Requires Git Bash or WSL on Windows | Native Windows support |
| Path issues on Windows | Native Windows paths |
| `pwsh` must be in Bash PATH | PowerShell 7 runs natively |
| `.sh` extension | `.ps1` extension |

---

## Tool Permissions

By default, Copilot CLI prompts for permission on each tool use.

### Fully Autonomous Mode

To skip permission prompts and run fully autonomously:

```powershell
.\ralph.ps1 run -AllowAllTools
```

This passes `--allow-all-tools` to Copilot CLI.

⚠️ **Warning:** This gives Copilot full tool access. Use with caution.

---

## The Ralph Philosophy

> "Ralph is a Bash loop." — Geoffrey Huntley

(Or in our case, a PowerShell loop! 😄)

The key insight: **failures are data**. Each failed iteration:

1. Logs the exact error
2. Records what was tried
3. Exits cleanly

The next iteration:

1. Sees the failure history
2. Tries a DIFFERENT approach
3. Eventually converges on a solution

---

## Troubleshooting

### "PowerShell 7+ required"

Install PowerShell 7:
```powershell
winget install Microsoft.PowerShell
```

Then run from `pwsh`, not the old `powershell`:
```powershell
pwsh
.\ralph.ps1 auto
```

### "Copilot CLI not found"

```powershell
npm install -g @github/copilot
copilot  # Authenticate
```

### "Not a git repository"

```powershell
git init
git add .
git commit -m "Initial commit"
```

---

## Credits

- Original technique: [Geoffrey Huntley](https://ghuntley.com/ralph/)
- GitHub Copilot CLI: [GitHub](https://github.com/features/copilot/cli)

---

## License

MIT
