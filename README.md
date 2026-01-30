# Ralph-RLM-Framework

An autonomous AI development framework based on [Geoffrey Huntley's Ralph Wiggum technique](https://ghuntley.com/ralph/) — iterative coding where failures drive improvement.

Now with **RLM (Recursive Language Model)** support for large codebases, based on [MIT research](https://arxiv.org/abs/2512.24601).

> "Ralph is a loop. Failures are data. Each iteration learns from the last."

## What is Ralph?

Ralph is an **autonomous coding loop** that takes your requirements and builds working software through iteration. When the AI makes a mistake, it sees that mistake in the next iteration and tries a different approach. This continues until the task is complete.

**The key insight:** Instead of expecting perfect output on the first try, Ralph embraces failure as a learning mechanism.

## Key Features

### PRD-Driven Development
Everything starts with a **`prd.md`** file in your project root. This is your Product Requirements Document — write what you want built, and Ralph figures out how to build it.

```
your-project/
├── prd.md               ← YOU WRITE THIS (or use ./ralph.sh author)
├── feature_list.json    ← Ralph creates this
├── validation-state.json
└── ... your code
```

### RLM: Large Codebase Support

Ralph now uses **RLM-style exploration** for large codebases. Instead of trying to read everything at once (which hits context limits), the AI:

1. **Searches** the codebase with `grep`/`find` to find relevant code
2. **Samples** specific files to understand patterns
3. **References** existing implementations when creating features

This means Ralph can work effectively with codebases of **any size** — 50 files or 5,000 files.

```
Traditional approach (fails on large codebases):
  AI tries to read all files → Context limit exceeded → Misses patterns

RLM approach (works at any scale):
  AI searches for "auth" → Finds AuthController.cs → Reads that file → Follows pattern
```

### Validation Loop
Before writing any code, Ralph **validates** that your requirements are fully covered:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   prd.md    │ ──► │    INIT     │ ──► │  VALIDATE   │ ◄─┐
│ (you write) │     │  (once)     │     │   (loop)    │ ──┘
└─────────────┘     └─────────────┘     └──────┬──────┘
                          │                    │ coverage ≥ 95%?
                          │ searches codebase  ▼
                          │ for existing code  ┌─────────────┐
                          ▼                    │  IMPLEMENT  │ ◄─┐
                    grep/find/head             │   (loop)    │ ──┘
                                               └─────────────┘
```

The validation phase ensures:
- Every requirement in your PRD maps to a feature
- Existing code is detected (no duplicate features)
- No requirements are missed or forgotten
- Coverage must reach 95%+ before implementation begins

### Three-Phase Architecture

| Phase | What Happens | Loops? |
|-------|--------------|--------|
| **1. Init** | Explores codebase, analyzes PRD, creates `feature_list.json` | Once |
| **2. Validate** | Searches for existing code, ensures 95%+ PRD coverage | Yes, until covered |
| **3. Implement** | Finds patterns with grep, builds features one by one | Yes, until complete |

### Skill-Based Architecture

Ralph uses modular **skills** — self-contained units of functionality with documentation and companion scripts. Each edition has skills in its native location:

**Claude Code** (`.claude/skills/` — auto-discovered):
```
.claude/skills/
├── ralph/                          # Core loop skills
│   ├── get-next-feature/           # Find next feature to implement
│   ├── update-feature-status/      # Change feature status
│   ├── increment-feature-attempts/ # Track failed attempts
│   ├── get-feature-stats/          # Get project stats
│   ├── prd-author/                 # Interactive PRD creation (/prd-author)
│   └── validate-prd/               # PRD quality checklist
├── test-driven-development/        # TDD Red-Green-Refactor enforcement
├── get-branch-name/                # Utility: git branch naming
├── nuget-manager/                  # Utility: safe NuGet management
└── docs-lookup/                    # Utility: API verification
```

**Copilot CLI** (`skills/` — referenced by prompts):
```
skills/
├── ralph/                          # Core loop skills (same structure)
├── test-driven-development/        # TDD Red-Green-Refactor enforcement
├── get-branch-name/
├── nuget-manager/
└── docs-lookup/
```

Each skill has a `SKILL.md` documenting its purpose, inputs, outputs, and rules. Claude Code skills include `.sh` companion scripts; Copilot CLI skills include `.ps1` scripts.

### Domain-Specific Coding Rules

Each edition uses its AI tool's native mechanism for auto-loading coding standards based on file patterns:

**Claude Code** (`.claude/rules/` — auto-loaded by path pattern):
```
.claude/rules/
├── csharp.md                       # C# standards (applies to **/*.cs)
├── playwright-dotnet.md            # Playwright .NET (applies to **/*Tests.cs)
└── TEMPLATE.md                     # Template for adding your own
```

**Copilot CLI** (`.github/instructions/` — auto-loaded by `applyTo:` pattern):
```
.github/instructions/
├── csharp.instructions.md
├── playwright-dotnet.instructions.md
└── TEMPLATE.instructions.md
```

Rules/instructions are automatically active when the AI works with matching file types. Add your own for any tech stack by copying the template.

### PRD Author Assistant

Don't know where to start? Run the PRD Author:

```bash
./ralph.sh author        # Bash
.\ralph.ps1 author       # PowerShell
```

The author skill guides you through creating a comprehensive PRD with:
- Project understanding (greenfield/brownfield/bugfix)
- Requirements deep dive (happy paths, edge cases, error handling)
- Test requirements (unit, integration, E2E)
- Dependency analysis and feature sizing

Philosophy: *"Ask 5 questions upfront rather than have Ralph fail 5 iterations."*

### Structured Knowledge Transfer

The progress file includes a **Codebase Patterns** section at the top — a living document of reusable patterns and learnings discovered during implementation. Each iteration reads this section first, ensuring consistency across the entire project.

### Structured Feature Decomposition

The Initializer uses a systematic methodology to convert your PRD into atomic features:

1. **Categorize** every requirement (functional, data/model, error handling, integration, non-functional, UI/UX)
2. **Decompose** along 4 axes: by entity, by operation, by path (happy/error/edge), by layer
3. **Enforce test criteria** — every feature must include "Build passes" + at least one test criterion
4. **Trace to source** — every feature links back to its PRD section via `source_requirement`
5. **Self-validate** — 8-point checklist before output (coverage, sizing, ordering, no duplicates, etc.)

### Feature Sizing Discipline

Ralph enforces right-sized features:
- Each feature must be completable in **one iteration** (one context window)
- Each feature should touch **2-4 files max**
- If you can't explain it in **2-3 sentences**, it's too big
- Features are ordered by `priority` with explicit `depends_on` for dependency chains
- The Validator automatically flags oversized features for splitting

## Two Editions

Choose based on your AI subscription:

| Edition | AI Agent | Shell | Best For |
|---------|----------|-------|----------|
| [claude-code/](./claude-code/) | Anthropic Claude | Bash | Claude Code users (Mac/Linux/WSL) |
| [copilot-cli/](./copilot-cli/) | GitHub Copilot | PowerShell 7 | Copilot users (Windows native) |

## Quick Start

### 1. Copy the framework to your project

**Claude Code (Bash):**
```bash
cp -r claude-code/* your-project/
cd your-project
```

**Copilot CLI (PowerShell):**
```powershell
Copy-Item -Recurse copilot-cli\* your-project\
Set-Location your-project
```

> ⚠️ **IMPORTANT:** Commit the framework files to git before running Ralph! When Ralph starts, it stashes uncommitted changes, which means you'll lose the copied framework files if they're not committed first.
> 
> ```bash
> git add .
> git commit -m "Add Ralph framework"
> ```

### 2. Write your requirements in `prd.md`

**Option A:** Use the interactive author for guided PRD creation:
```bash
./ralph.sh author        # Bash
.\ralph.ps1 author       # PowerShell
```

**Option B:** Write manually using the template:

```markdown
# Product Requirements Document

## Project Overview
**Project Name:** My Awesome App
**Tech Stack:** Node.js, Express, PostgreSQL

## Functional Requirements
- Users can sign up with email and password
- Users can create, read, update, delete tasks
- Tasks have title, description, due date, and status

## Non-Functional Requirements
- API response time under 200ms
- Input validation on all endpoints
- Unit test coverage above 80%
```

### 3. Authenticate with your AI service

**Claude Code:**
Make sure you're authenticated with Claude Code

**Copilot CLI:**
Make sure you're logged in and authenticated with GitHub Copilot

### 4. Run Ralph

**Claude Code:**
```bash
./ralph.sh auto
```

**Copilot CLI:**
```powershell
.\ralph.ps1 auto -AllowAllTools
```

### 5. Watch it work

Ralph will:
1. **Initialize** — Parse your PRD, create features
2. **Validate** — Ensure all requirements are covered (loops until 95%+)
3. **Implement** — Build each feature, retrying on failures (loops until done)

## Commands

| Command | Description |
|---------|-------------|
| `author` | Interactive PRD creation assistant |
| `auto` | Run all phases automatically |
| `init` | Phase 1: Create features from PRD |
| `validate` | Phase 2: Validate PRD coverage |
| `run` | Phase 3: Implement features |
| `status` | Show current project state |
| `help` | Show help |

## How It Works

### The Ralph Philosophy

Traditional AI coding:
```
Prompt → AI → Output (hope it's right!)
```

Ralph approach:
```
Prompt → AI → Output → Check → Failed? → Loop with failure context → ...
```

Each iteration:
1. Reads current state (features, progress, errors)
2. Picks the next incomplete feature
3. Attempts implementation
4. Records success or failure
5. Commits progress to git
6. Loops back with updated context

### Progress Tracking

Ralph maintains state in several files:
- `feature_list.json` — All features with status (pending/in_progress/complete/blocked)
- `validation-state.json` — PRD coverage percentage and gaps
- `claude-progress.txt` / `copilot-progress.txt` — Detailed iteration log with Codebase Patterns section

### Data-Driven Completion

Completion is detected by querying `feature_list.json` directly — no magic strings or signal files:
- **All features complete** (none pending/in_progress/blocked) → Loop exits successfully
- **Some blocked, none pending** → Loop exits, human intervention needed
- **Still pending/in_progress** → Loop continues to next iteration
- **Max iterations reached** → Loop exits, check feature_list.json for progress

Because completion is derived from the data, you can **add new features at any time** — just add entries to `feature_list.json` with `"status": "pending"` and re-run.

### Safety Features

- **Git checkpoints** — Progress is committed, easy to rollback
- **Blocked status** — If stuck, Ralph marks features as blocked for human review
- **Max iterations** — Configurable limit prevents infinite loops
- **Tool restrictions** — Dangerous operations (rm, sudo) are blocked by default

## Requirements

### Claude Code Edition
- [Claude Code CLI](https://github.com/anthropics/claude-code) installed
- Anthropic API key configured
- Git, Bash

### Copilot CLI Edition  
- [GitHub Copilot CLI](https://github.com/features/copilot/cli) installed
- GitHub Copilot subscription
- PowerShell 7+, Git

## Configuration

### Command-Line Flags

Both editions support these flags:

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--max-iterations` | `-m` | 50 | Max implementation iterations before stopping |
| `--max-validate-iterations` | | 10 | Max validation iterations |
| `--coverage-threshold` | `-c` | 95 | Required PRD coverage % before implementation |
| `--sleep` | `-s` | 2 | Seconds between iterations |
| `--verbose` | `-v` | false | Show context summary and debug info (Bash only) |
| `-AllowAllTools` | | false | Enable all Copilot tools (PowerShell only, less safe) |

**Examples:**
```bash
# Bash - Run with max 100 iterations and 90% coverage threshold
./ralph.sh auto -m 100 -c 90

# Bash - Verbose mode with debug output
./ralph.sh run -v
```

```powershell
# PowerShell - Run with max 100 iterations
.\ralph.ps1 auto -MaxIterations 100

# PowerShell - Allow all tools (fully autonomous, less safe)
.\ralph.ps1 run -AllowAllTools
```

### Environment Variables (Bash Edition)

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_VALIDATE_ITERATIONS` | 10 | Max validation loops |
| `MAX_IMPLEMENT_ITERATIONS` | 50 | Max implementation loops |
| `COVERAGE_THRESHOLD` | 95 | Required PRD coverage % |
| `SLEEP_BETWEEN` | 2 | Seconds between iterations |
| `VERBOSE` | false | Enable debug output |

**Example:**
```bash
MAX_IMPLEMENT_ITERATIONS=100 COVERAGE_THRESHOLD=90 ./ralph.sh auto
```

---

## Files Reference

### Input Files (You Create)

| File | Description |
|------|-------------|
| `prd.md` | Your Product Requirements Document - the input for Ralph |

### Generated Files (Ralph Creates)

| File | Description |
|------|-------------|
| `feature_list.json` | All features extracted from PRD with status tracking |
| `validation-state.json` | PRD coverage percentage and identified gaps |
| `claude-progress.txt` | Detailed iteration log with Codebase Patterns section (Claude Code edition) |
| `copilot-progress.txt` | Detailed iteration log with Codebase Patterns section (Copilot CLI edition) |
| `ralph-debug.log` | Debug log when running in verbose mode |

### Framework Directories

Each edition is self-contained with its own skills and coding rules in native locations:

**Claude Code Edition:**

| Directory | Description |
|-----------|-------------|
| `.claude/skills/ralph/` | Core Ralph loop skills (get-next-feature, update-feature-status, etc.) |
| `.claude/skills/` | General utility skills (get-branch-name, nuget-manager, docs-lookup) |
| `.claude/rules/` | Auto-loaded coding standards (by file path pattern) |
| `prompts/` | Agent prompt files (initializer, validator, implementer) |

**Copilot CLI Edition:**

| Directory | Description |
|-----------|-------------|
| `skills/ralph/` | Core Ralph loop skills (get-next-feature, update-feature-status, etc.) |
| `skills/` | General utility skills (get-branch-name, nuget-manager, docs-lookup) |
| `.github/instructions/` | Auto-loaded coding instructions (by `applyTo:` pattern) |
| `prompts/` | Agent prompt files (initializer, validator, implementer) |

### Feature Statuses

| Status | Meaning |
|--------|---------|
| `pending` | Not yet started |
| `in_progress` | Currently being implemented |
| `complete` | Successfully implemented |
| `blocked` | Stuck - needs human intervention (see Troubleshooting) |

---

## Troubleshooting

### Feature Marked as "Blocked"

When Ralph can't complete a feature after multiple attempts, it marks it as `blocked`. This means:

1. **Check the progress file** - Look at `claude-progress.txt` or `copilot-progress.txt` for error details
2. **Check `feature_list.json`** - The `last_error` field shows what went wrong
3. **Fix manually or clarify PRD** - Either fix the issue yourself or update `prd.md` with clearer requirements
4. **Reset the feature** - Change `status` back to `pending` and `attempts` to `0` in `feature_list.json`
5. **Resume** - Run `./ralph.sh run` to continue

### Validation Never Reaches 95%

If the validation phase loops without reaching coverage:

1. **Check `validation-state.json`** - Look at the `gaps` array to see what's missing
2. **Update feature_list.json** - Add features to cover the gaps
3. **Lower threshold temporarily** - Use `-c 80` flag to allow lower coverage
4. **Simplify PRD** - Remove ambiguous or overly complex requirements

### Ralph Seems Stuck in a Loop

1. **Check iteration count** - It may be retrying failed operations
2. **Lower max iterations** - Use `-m 10` to stop earlier and inspect
3. **Check for API issues** - Ensure Claude Code or Copilot CLI is authenticated
4. **Review progress file** - Look for repeating errors

### "Context limit exceeded" Errors

This shouldn't happen with RLM, but if it does:

1. **Split large PRD** - Break into multiple smaller PRDs
2. **Reduce feature scope** - Simplify acceptance criteria
3. **Use verbose mode** - Run with `-v` to see what files are being read

### Git Stash Issues

Ralph stashes uncommitted changes before running. If you lose changes:

```bash
# List stashes
git stash list

# Restore most recent stash
git stash pop
```

### Common Error Messages

| Error | Solution |
|-------|----------|
| "Not a git repository" | Run `git init` in your project |
| "prd.md not found" | Create your PRD file first |
| "feature_list.json not found" | Run `init` phase first |
| "Claude Code CLI not found" | Install with `npm install -g @anthropic-ai/claude-code` |
| "GitHub Copilot CLI not found" | Install with `npm install -g @github/copilot` |

---

## Examples

Each edition includes a complete example:

- **Claude Code:** `claude-code/examples/pharmacy-bot/`
- **Copilot CLI:** `copilot-cli/examples/pharmacy-bot/`

### Pharmacy Bot Example

A Slack bot for pharmacy inventory management demonstrating:

- Real-world PRD with functional and non-functional requirements
- Generated feature list with 8 features
- Acceptance criteria mapping

**Sample PRD excerpt:**
```markdown
## Functional Requirements

### Inventory Queries
- Users must be able to query stock by medication name
- The system must return current stock count and storage location
- The system must handle partial name matches (fuzzy search)
- Queries must return results within 3 seconds
```

**Generated feature example:**
```json
{
  "id": "F003",
  "description": "Inventory query from pharmacy API",
  "priority": 3,
  "depends_on": ["F001", "F002"],
  "source_requirement": "## Functional Requirements > Inventory Queries",
  "acceptance_criteria": [
    "Can query inventory API with medication name",
    "Returns stock count and location",
    "Handles API timeouts with retry",
    "Unit test: InventoryServiceTests.Query_ValidName_ReturnsStock verifies behavior",
    "Build passes (npm test)"
  ],
  "verification_steps": ["npm run build", "npm test"],
  "status": "pending"
}
```

To try the example:
```bash
cd claude-code
cp -r examples/pharmacy-bot/* ../my-test-project/
cd ../my-test-project
./ralph.sh auto
```

## Tips for Better Results

1. **Use `./ralph.sh author`** — Let the PRD Author guide you through writing requirements
2. **Be specific in your PRD** — More detail = better features
3. **Include error cases** — "When X fails, show Y message"
4. **Specify tech stack** — "Use Express, not Fastify"
5. **Right-size requirements** — Each should map to 2-4 files max
6. **Add coding rules** — Copy the TEMPLATE and customize for your stack (`.claude/rules/` or `.github/instructions/`)
7. **Check `status` often** — See what's complete vs blocked
8. **Add features mid-project** — Add new entries to `feature_list.json` with `"status": "pending"` and re-run

## Credits

- Original Ralph Wiggum technique: [Geoffrey Huntley](https://ghuntley.com/ralph/)
- Framework adaptation: Waseem

## License

MIT — See [LICENSE](./LICENSE)
