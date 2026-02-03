#Requires -Version 5.1
<#
.SYNOPSIS
    Ralph-RLM-Framework v2.0 (Claude Code CLI Edition - PowerShell)
    Based on Geoffrey Huntley's Ralph Wiggum technique

.DESCRIPTION
    Three-phase autonomous development:
      Phase 1: Initialize - PRD -> feature_list.json
      Phase 2: Validate   - Ensure PRD fully covered (loops)
      Phase 3: Implement  - Build features (loops)

.EXAMPLE
    .\ralph.ps1 init       # Phase 1: Create features from PRD
    .\ralph.ps1 validate   # Phase 2: Validate PRD coverage
    .\ralph.ps1 run        # Phase 3: Implement features
    .\ralph.ps1 auto       # All phases automatically
    .\ralph.ps1 status     # Show current state
    .\ralph.ps1 help       # Show this help

.NOTES
    Requires: Claude Code CLI (npm install -g @anthropic-ai/claude-code)
#>

param(
    [Parameter(Position = 0)]
    [ValidateSet('author', 'init', 'validate', 'run', 'implement', 'auto', 'status', 'help')]
    [string]$Command = 'help',

    [Alias('m')]
    [int]$MaxIterations = 50,

    [int]$MaxValidateIterations = 10,

    [Alias('c')]
    [int]$CoverageThreshold = 95,

    [Alias('s')]
    [int]$SleepBetween = 2,

    [Alias('v')]
    [switch]$VerboseOutput,

    [switch]$DebugMode,

    [switch]$DangerouslySkipPermissions,

    [switch]$Stream
)

# ======================================================================
# Script Directory (for finding prompts)
# ======================================================================

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PromptsDir = Join-Path $ScriptDir "prompts"
$SkillsDir = Join-Path (Join-Path $ScriptDir ".claude") "skills"

# ======================================================================
# Configuration
# ======================================================================

$script:MAX_VALIDATE_ITERATIONS = $MaxValidateIterations
$script:MAX_IMPLEMENT_ITERATIONS = $MaxIterations
$script:SLEEP_BETWEEN = $SleepBetween
$script:COVERAGE_THRESHOLD = $CoverageThreshold
$script:VERBOSE = $VerboseOutput.IsPresent -or $DebugMode.IsPresent
$script:DEBUG_MODE = $DebugMode.IsPresent
$script:ALLOW_ALL_TOOLS = $DangerouslySkipPermissions.IsPresent
$script:STREAM_OUTPUT = $Stream.IsPresent
$script:LOG_FILE = "ralph-debug.log"

# ======================================================================
# Colors & Formatting
# ======================================================================

function Write-Banner {
    Write-Host ""
    Write-Host "==================================================================" -ForegroundColor Blue
    Write-Host "||  " -ForegroundColor Blue -NoNewline
    Write-Host "RALPH-RLM FRAMEWORK v2.0" -ForegroundColor White -NoNewline
    Write-Host "                                   ||" -ForegroundColor Blue
    Write-Host "||  " -ForegroundColor Blue -NoNewline
    Write-Host "Claude Code CLI Edition (PowerShell)" -ForegroundColor Cyan -NoNewline
    Write-Host "                      ||" -ForegroundColor Blue
    Write-Host "||  Based on Geoffrey Huntley's Ralph Wiggum technique           ||" -ForegroundColor Blue
    Write-Host "==================================================================" -ForegroundColor Blue
    Write-Host ""
}

function Write-Phase {
    param([string]$Text)
    Write-Host ""
    Write-Host "----------------------------------------------------------------" -ForegroundColor Cyan
    Write-Host "  $Text" -ForegroundColor White
    Write-Host "----------------------------------------------------------------" -ForegroundColor Cyan
    Write-Host ""
}

function Write-RalphSuccess { param([string]$Text) Write-Host "[+] $Text" -ForegroundColor Green }
function Write-RalphWarning { param([string]$Text) Write-Host "[!] $Text" -ForegroundColor Yellow }
function Write-RalphError   { param([string]$Text) Write-Host "[x] $Text" -ForegroundColor Red }
function Write-RalphInfo    { param([string]$Text) Write-Host "[i] $Text" -ForegroundColor Blue }

# ======================================================================
# Verbose/Debug Functions
# ======================================================================

function Write-DebugLog {
    param([string]$Message)
    if ($script:VERBOSE) {
        Write-Host "[DEBUG] $Message" -ForegroundColor Cyan
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        "[$timestamp] $Message" | Out-File -FilePath $script:LOG_FILE -Append -Encoding UTF8
    }
}

# Build Claude CLI flags
function Get-ClaudeFlags {
    $flags = @()

    # Full bypass mode
    if ($script:ALLOW_ALL_TOOLS) {
        $flags += "--dangerously-skip-permissions"
    }

    # Verbosity flags
    if ($script:DEBUG_MODE) {
        $flags += "--debug"
    }
    elseif ($script:VERBOSE) {
        $flags += "--verbose"
    }

    # Stream JSON output
    if ($script:STREAM_OUTPUT) {
        $flags += "--output-format"
        $flags += "stream-json"
    }

    return $flags
}

function Show-ContextSummary {
    if (-not $script:VERBOSE) {
        return
    }

    Write-Host ""
    Write-Host "----------------------------------------------------------------" -ForegroundColor Cyan
    Write-Host "  CONTEXT SUMMARY (RLM)" -ForegroundColor White
    Write-Host "----------------------------------------------------------------" -ForegroundColor Cyan

    # PRD size
    if (Test-Path "prd.md") {
        $prdLines = @(Get-Content "prd.md").Count
        $prdSize = (Get-Item "prd.md").Length
        $prdSizeKB = [math]::Round($prdSize / 1024, 1)
        Write-Host "  prd.md: $prdLines lines (${prdSizeKB}KB)" -ForegroundColor White
        if ($prdLines -gt 500) {
            Write-Host "    -> Large PRD: AI will use grep/search to read sections" -ForegroundColor Yellow
        }
        else {
            Write-Host "    -> Small PRD: AI can read directly" -ForegroundColor Green
        }
    }

    # Feature list size
    if (Test-Path "feature_list.json") {
        try {
            $data = Get-Content "feature_list.json" -Raw | ConvertFrom-Json
            $featureCount = @($data.features).Count
            $featureSize = (Get-Item "feature_list.json").Length
            $featureSizeKB = [math]::Round($featureSize / 1024, 1)
            Write-Host "  feature_list.json: $featureCount features (${featureSizeKB}KB)" -ForegroundColor White
            if ($featureCount -gt 50) {
                Write-Host "    -> Many features: AI will use targeted queries" -ForegroundColor Yellow
            }
            else {
                Write-Host "    -> Few features: AI can read directly" -ForegroundColor Green
            }

            # Show status breakdown
            $complete   = @($data.features | Where-Object { $_.status -eq "complete" }).Count
            $pending    = @($data.features | Where-Object { $_.status -eq "pending" }).Count
            $inProgress = @($data.features | Where-Object { $_.status -eq "in_progress" }).Count
            $blocked    = @($data.features | Where-Object { $_.status -eq "blocked" }).Count
            Write-Host "    Status: " -NoNewline
            Write-Host "$complete done" -ForegroundColor Green -NoNewline
            Write-Host " | " -NoNewline
            Write-Host "$inProgress active" -ForegroundColor Yellow -NoNewline
            Write-Host " | " -NoNewline
            Write-Host "$pending pending" -ForegroundColor Blue -NoNewline
            Write-Host " | " -NoNewline
            Write-Host "$blocked blocked" -ForegroundColor Red
        }
        catch {
            Write-Host "  feature_list.json: (parse error)" -ForegroundColor Red
        }
    }

    # Codebase size
    $codeExtensions = @("*.py", "*.js", "*.ts", "*.cs", "*.java", "*.go")
    $codeFiles = 0
    foreach ($ext in $codeExtensions) {
        $codeFiles += @(Get-ChildItem -Path . -Filter $ext -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notmatch '(node_modules|\.git|venv|bin|obj)' }).Count
    }
    Write-Host "  Codebase: $codeFiles code files" -ForegroundColor White
    if ($codeFiles -gt 50) {
        Write-Host "    -> Large codebase: AI will use grep/find to search" -ForegroundColor Yellow
    }
    else {
        Write-Host "    -> Small codebase: AI can explore directly" -ForegroundColor Green
    }

    # Progress file
    if (Test-Path "claude-progress.txt") {
        $progressLines = @(Get-Content "claude-progress.txt").Count
        Write-Host "  claude-progress.txt: $progressLines lines" -ForegroundColor White
        if ($progressLines -gt 200) {
            Write-Host "    -> Long history: AI will read last 50 lines" -ForegroundColor Yellow
        }
    }

    Write-Host ""
    Write-DebugLog "Context summary displayed"
}

# ======================================================================
# Help
# ======================================================================

function Show-Help {
    Write-Banner

    Write-Host "USAGE" -ForegroundColor White
    Write-Host "  .\ralph.ps1 <command> [options]"
    Write-Host ""

    Write-Host "COMMANDS" -ForegroundColor White
    Write-Host "  author      Interactive PRD creation assistant"
    Write-Host "  init        Phase 1: Analyze PRD and create feature_list.json"
    Write-Host "  validate    Phase 2: Validate all PRD requirements are covered (loops)"
    Write-Host "  run         Phase 3: Implement features one by one (loops)"
    Write-Host "  auto        Run all phases automatically"
    Write-Host "  status      Show current project state"
    Write-Host "  help        Show this help message"
    Write-Host ""

    Write-Host "FLAGS" -ForegroundColor White
    Write-Host "  -MaxIterations, -m N              Max implementation iterations (default: 50)"
    Write-Host "  -MaxValidateIterations N          Max validation iterations (default: 10)"
    Write-Host "  -CoverageThreshold, -c N          Required PRD coverage % (default: 95)"
    Write-Host "  -SleepBetween, -s N               Seconds between iterations (default: 2)"
    Write-Host "  -VerboseOutput, -v                Show context summary and RLM debug info"
    Write-Host "  -DebugMode                        Enable Claude Code debug-level tracing (implies -VerboseOutput)"
    Write-Host "  -DangerouslySkipPermissions       Full tool access with deny rules (less safe, faster)"
    Write-Host "  -Stream                           Stream Claude Code output as JSON (for CI/automation)"
    Write-Host ""

    Write-Host "WORKFLOW" -ForegroundColor White
    Write-Host ""
    Write-Host "  +-------------+     +-------------+     +-------------+"
    Write-Host "  |   prd.md    | --> |  INIT       | --> |  VALIDATE   |"
    Write-Host "  | (you write) |     |  (once)     |     |  (loops)    |"
    Write-Host "  +-------------+     +-------------+     +------+------+"
    Write-Host "                                                 |"
    Write-Host "                                                 v"
    Write-Host "                                          +-------------+"
    Write-Host "                                          |  IMPLEMENT  |"
    Write-Host "                                          |  (loops)    |"
    Write-Host "                                          +-------------+"
    Write-Host ""

    Write-Host "QUICK START" -ForegroundColor White
    Write-Host "  1. Run: .\ralph.ps1 author    (get help writing your PRD)"
    Write-Host "  2. Write your requirements in prd.md"
    Write-Host "  3. Run: .\ralph.ps1 auto"
    Write-Host "  4. Go make coffee"
    Write-Host ""

    Write-Host "EXAMPLES" -ForegroundColor White
    Write-Host "  .\ralph.ps1 author                                          # Get help writing your PRD"
    Write-Host "  .\ralph.ps1 auto                                            # Run everything"
    Write-Host "  .\ralph.ps1 auto -v                                         # Run with context summary"
    Write-Host "  .\ralph.ps1 init                                            # Just create features"
    Write-Host "  .\ralph.ps1 validate                                        # Just validate coverage"
    Write-Host "  .\ralph.ps1 run                                             # Just implement"
    Write-Host "  .\ralph.ps1 run -m 10                                       # Run with max 10 iterations"
    Write-Host "  .\ralph.ps1 run -MaxIterations 100                          # Run with max 100 iterations"
    Write-Host "  .\ralph.ps1 validate -c 90                                  # Validate with 90% threshold"
    Write-Host "  .\ralph.ps1 run -v                                          # Run with verbose/debug output"
    Write-Host "  .\ralph.ps1 run -DangerouslySkipPermissions                 # Full tool access (less safe)"
    Write-Host "  .\ralph.ps1 auto -DangerouslySkipPermissions -DebugMode     # Full access + debug tracing"
    Write-Host ""

    Write-Host "FILES" -ForegroundColor White
    Write-Host "  prd.md                Your requirements (input)"
    Write-Host "  feature_list.json     Generated features with status"
    Write-Host "  validation-state.json Validation coverage tracking"
    Write-Host "  claude-progress.txt   Detailed iteration log"
    Write-Host ""

    Write-Host "FRAMEWORK DIRECTORIES" -ForegroundColor White
    Write-Host "  .claude\skills\       Auto-discovered skill definitions and scripts"
    Write-Host "  .claude\skills\ralph\ Core Ralph loop skills"
    Write-Host "  .claude\rules\        Auto-loaded coding rules (by file pattern)"
    Write-Host ""

    Write-Host "LEARN MORE" -ForegroundColor White
    Write-Host "  Original technique: https://ghuntley.com/ralph/"
    Write-Host ""
}

# ======================================================================
# Pre-flight Checks
# ======================================================================

function Test-Preflight {
    param([string]$Phase)

    Write-Host ""
    Write-Host "Pre-flight checks..." -ForegroundColor Blue

    # Check: Git repository
    if (-not (Test-Path ".git")) {
        Write-RalphError "Not a git repository! Ralph requires git for safety."
        Write-Host "       Run: git init" -ForegroundColor Gray
        return $false
    }
    Write-RalphSuccess "Git repository detected"

    # Check: Claude Code CLI
    $claudePath = Get-Command "claude" -ErrorAction SilentlyContinue
    if (-not $claudePath) {
        Write-RalphError "Claude Code CLI not found!"
        Write-Host "       Install: npm install -g @anthropic-ai/claude-code" -ForegroundColor Gray
        return $false
    }
    Write-RalphSuccess "Claude Code CLI found"

    # Phase-specific checks
    switch ($Phase) {
        'init' {
            if (-not (Test-Path "prd.md")) {
                Write-RalphError "prd.md not found!"
                Write-Host "       Create prd.md with your project requirements first." -ForegroundColor Gray
                Write-Host "       See templates\prd.md for an example." -ForegroundColor Gray
                return $false
            }
            Write-RalphSuccess "prd.md found"

            $initPrompt = Join-Path $PromptsDir "initializer.md"
            if (-not (Test-Path $initPrompt)) {
                Write-RalphError "$PromptsDir\initializer.md not found!"
                return $false
            }
            Write-RalphSuccess "initializer.md found"
        }
        'validate' {
            if (-not (Test-Path "prd.md")) {
                Write-RalphError "prd.md not found!"
                return $false
            }
            Write-RalphSuccess "prd.md found"

            if (-not (Test-Path "feature_list.json")) {
                Write-RalphError "feature_list.json not found!"
                Write-Host "       Run '.\ralph.ps1 init' first." -ForegroundColor Gray
                return $false
            }
            Write-RalphSuccess "feature_list.json found"

            $valPrompt = Join-Path $PromptsDir "validator.md"
            if (-not (Test-Path $valPrompt)) {
                Write-RalphError "validator.md not found!"
                return $false
            }
            Write-RalphSuccess "validator.md found"
        }
        'run' {
            if (-not (Test-Path "feature_list.json")) {
                Write-RalphError "feature_list.json not found!"
                Write-Host "       Run '.\ralph.ps1 init' first." -ForegroundColor Gray
                return $false
            }
            Write-RalphSuccess "feature_list.json found"

            $implPrompt = Join-Path $PromptsDir "implementer.md"
            if (-not (Test-Path $implPrompt)) {
                Write-RalphError "implementer.md not found!"
                return $false
            }
            Write-RalphSuccess "implementer.md found"

            if (-not (Test-Path "claude-progress.txt")) {
                Write-RalphWarning "claude-progress.txt not found, creating..."
                New-Item -ItemType File -Path "claude-progress.txt" | Out-Null
            }
            Write-RalphSuccess "claude-progress.txt found"
        }
    }

    Write-Host ""
    return $true
}

# ======================================================================
# Invoke Claude CLI
# ======================================================================

function Invoke-Claude {
    param([string]$Prompt)

    $flags = Get-ClaudeFlags

    Write-DebugLog "Invoking claude with flags: $($flags -join ' ')"
    Write-DebugLog "Prompt length: $($Prompt.Length) chars"

    if ([string]::IsNullOrWhiteSpace($Prompt)) {
        Write-RalphError "Prompt is empty!"
        return 1
    }

    # Build full argument list including -p and prompt
    $allArgs = @()
    $allArgs += $flags
    $allArgs += "-p"
    $allArgs += $Prompt

    Write-DebugLog "Running claude with $($allArgs.Count) args"

    & claude @allArgs

    return $LASTEXITCODE
}

# ======================================================================
# Stats Safety Net
# ======================================================================

function Repair-FeatureStats {
    <#
    .SYNOPSIS
        Recalculate .stats from actual .features[].status values.
        Prevents stats drift if Claude edits feature_list.json directly
        instead of using companion scripts.
    #>
    if (-not (Test-Path "feature_list.json")) {
        return
    }

    try {
        $raw = Get-Content "feature_list.json" -Raw
        $data = $raw | ConvertFrom-Json

        if (-not $data.features) {
            return
        }

        $complete   = @($data.features | Where-Object { $_.status -eq "complete" }).Count
        $inProgress = @($data.features | Where-Object { $_.status -eq "in_progress" }).Count
        $pending    = @($data.features | Where-Object { $_.status -eq "pending" }).Count
        $blocked    = @($data.features | Where-Object { $_.status -eq "blocked" }).Count

        # Ensure stats object exists
        if (-not $data.stats) {
            $data | Add-Member -NotePropertyName "stats" -NotePropertyValue ([PSCustomObject]@{}) -Force
        }

        $data.stats.complete    = $complete
        $data.stats.in_progress = $inProgress
        $data.stats.pending     = $pending
        $data.stats.blocked     = $blocked

        $data | ConvertTo-Json -Depth 10 | Set-Content "feature_list.json" -Encoding UTF8

        Write-DebugLog "Stats repaired: complete=$complete, in_progress=$inProgress, pending=$pending, blocked=$blocked"
    }
    catch {
        Write-DebugLog "Stats repair failed: $_"
    }
}

# ======================================================================
# YAML Frontmatter Stripping
# ======================================================================

function Get-SkillContent {
    <#
    .SYNOPSIS
        Read a skill file, stripping YAML frontmatter if present.
        Frontmatter (---..---) can confuse claude CLI flag parsing.
    #>
    param([string]$Path)

    $lines = Get-Content $Path
    if ($lines.Count -gt 0 -and $lines[0] -eq "---") {
        # Find the closing ---
        $endIndex = -1
        for ($i = 1; $i -lt $lines.Count; $i++) {
            if ($lines[$i] -eq "---") {
                $endIndex = $i
                break
            }
        }
        if ($endIndex -ge 0 -and ($endIndex + 1) -lt $lines.Count) {
            return ($lines[($endIndex + 1)..($lines.Count - 1)] -join "`n")
        }
    }

    return ($lines -join "`n")
}

# ======================================================================
# PRD Author (Interactive)
# ======================================================================

function Start-Author {
    Write-Phase "PRD AUTHOR"
    Write-Host "Interactive PRD creation assistant..."
    Write-Host ""

    # Check: Git repository
    if (-not (Test-Path ".git")) {
        Write-RalphError "Not a git repository! Initialize with: git init"
        exit 1
    }

    # Check: Claude Code CLI
    $claudePath = Get-Command "claude" -ErrorAction SilentlyContinue
    if (-not $claudePath) {
        Write-RalphError "Claude Code CLI not found!"
        Write-Host "       Install: npm install -g @anthropic-ai/claude-code" -ForegroundColor Gray
        exit 1
    }

    # Check: PRD Author skill
    $skillFile = Join-Path (Join-Path (Join-Path $SkillsDir "ralph") "prd-author") "SKILL.md"
    if (-not (Test-Path $skillFile)) {
        Write-RalphError "PRD Author skill not found at: $skillFile"
        exit 1
    }
    Write-RalphSuccess "PRD Author skill found"

    # Check: PRD template
    $templateFile = Join-Path (Join-Path $ScriptDir "templates") "prd.md"
    if (Test-Path $templateFile) {
        Write-RalphSuccess "PRD template found"
    }

    Write-Host ""
    Write-RalphInfo "Running PRD Author assistant..."
    Write-RalphInfo "This will guide you through creating a high-quality prd.md"
    Write-Host ""

    # Read skill content, stripping YAML frontmatter
    $skillContent = Get-SkillContent -Path $skillFile

    $fullPrompt = @"
$skillContent

You are helping the user create a prd.md for Ralph-RLM-Framework.

If a prd.md template exists at templates\prd.md, use it as the output structure.
Guide the user through each phase described above.
Save the final result as prd.md in the current directory.

Start by asking the user about their project (Phase 1: Project Understanding).
"@

    # Use interactive mode (no -p flag) so the user can answer questions
    $flags = Get-ClaudeFlags
    if ($flags.Count -gt 0) {
        & claude @flags $fullPrompt
    }
    else {
        & claude $fullPrompt
    }

    if (Test-Path "prd.md") {
        Write-Host ""
        Write-RalphSuccess "prd.md created successfully!"
        Write-Host ""
        Write-Host "Next steps:"
        Write-Host "  1. Review prd.md"
        Write-Host "  2. Run: .\ralph.ps1 auto"
    }
    else {
        Write-RalphWarning "prd.md was not created. You can create it manually using templates\prd.md"
    }
}

# ======================================================================
# Phase 1: Initialize
# ======================================================================

function Start-Init {
    Write-Phase "PHASE 1: INITIALIZE"
    Write-Host "Analyzing PRD and creating feature_list.json..."
    Write-Host ""

    if (-not (Test-Preflight 'init')) {
        exit 1
    }
    Show-ContextSummary

    # Create safety checkpoint
    git stash push -m "ralph-pre-init-$(Get-Date -Format 'yyyyMMddHHmmss')" --include-untracked 2>$null

    Write-DebugLog "Starting initializer agent"

    # Build the prompt
    $initPromptPath = Join-Path $PromptsDir "initializer.md"
    $initPrompt = Get-Content $initPromptPath -Raw

    $fullPrompt = @"
$initPrompt

Read the project requirements from: prd.md
"@

    # Run Claude
    Write-RalphInfo "Running initializer agent..."
    Write-Host ""

    Invoke-Claude -Prompt $fullPrompt

    if (Test-Path "feature_list.json") {
        try {
            $features = Get-Content "feature_list.json" -Raw | ConvertFrom-Json
            $featureCount = @($features.features).Count
            Write-Host ""
            Write-RalphSuccess "Initialization complete!"
            Write-RalphInfo "Created $featureCount features in feature_list.json"
            Write-DebugLog "Init complete: $featureCount features created"
            Write-Host ""
            Write-Host "Next step: .\ralph.ps1 validate"
        }
        catch {
            Write-Host ""
            Write-RalphError "feature_list.json created but could not be parsed: $_"
            exit 1
        }
    }
    else {
        Write-RalphError "Initialization failed - feature_list.json not created"
        Write-DebugLog "Init FAILED: feature_list.json not created"
        exit 1
    }
}

# ======================================================================
# Phase 2: Validate
# ======================================================================

function Start-Validate {
    Write-Phase "PHASE 2: VALIDATE PRD COVERAGE"
    Write-Host "Ensuring all requirements are covered by features..."
    Write-Host ""

    if (-not (Test-Preflight 'validate')) {
        exit 1
    }
    Show-ContextSummary

    $iteration = 0

    # Initialize validation state if not exists
    if (-not (Test-Path "validation-state.json")) {
        @{
            coverage_percent = 0
            iteration        = 0
            status           = "in_progress"
            gaps             = @()
            last_updated     = (Get-Date -Format "o")
        } | ConvertTo-Json -Depth 10 | Set-Content "validation-state.json" -Encoding UTF8
    }

    while ($iteration -lt $script:MAX_VALIDATE_ITERATIONS) {
        Write-Host ""
        Write-Host "--- Validation Iteration $($iteration + 1) of $script:MAX_VALIDATE_ITERATIONS ---" -ForegroundColor Cyan
        Write-DebugLog "Validation iteration $($iteration + 1) starting"
        Write-Host ""

        # Build the prompt
        $valPromptPath = Join-Path $PromptsDir "validator.md"
        $valPrompt = Get-Content $valPromptPath -Raw

        $fullPrompt = @"
$valPrompt

Read these files from the current directory:
- prd.md (the original PRD)
- feature_list.json (current features)
- validation-state.json (validation state)
"@

        # Run Claude
        Invoke-Claude -Prompt $fullPrompt

        # Check for completion
        if (Test-Path "validation-state.json") {
            try {
                $valState = Get-Content "validation-state.json" -Raw | ConvertFrom-Json
                $coverage = $valState.coverage_percent
                $status = $valState.status

                Write-DebugLog "Validation result: coverage=$coverage%, status=$status"

                if ($status -eq "complete" -or $coverage -ge $script:COVERAGE_THRESHOLD) {
                    Write-Host ""
                    Write-RalphSuccess "Validation complete! Coverage: $coverage%"
                    Write-Host ""
                    Write-Host "Next step: .\ralph.ps1 run"
                    return 0
                }

                if ($status -eq "blocked") {
                    Write-Host ""
                    Write-RalphWarning "Validation blocked - human review needed"
                    Write-RalphInfo "Check validation-state.json for details"
                    return 2
                }
            }
            catch {
                Write-DebugLog "Failed to parse validation-state.json: $_"
            }
        }

        $iteration++

        if ($iteration -lt $script:MAX_VALIDATE_ITERATIONS) {
            Write-RalphInfo "Coverage not met. Retrying in $script:SLEEP_BETWEEN seconds..."
            Start-Sleep -Seconds $script:SLEEP_BETWEEN
        }
    }

    Write-Host ""
    Write-RalphWarning "Max validation iterations reached ($script:MAX_VALIDATE_ITERATIONS)"
    Write-RalphInfo "Check validation-state.json for current coverage"
    return 1
}

# ======================================================================
# Phase 3: Implement (Ralph Loop)
# ======================================================================

function Start-Implement {
    Write-Phase "PHASE 3: IMPLEMENT FEATURES (RALPH LOOP)"
    Write-Host "Implementing features one by one until complete..."
    Write-Host ""

    if (-not (Test-Preflight 'run')) {
        exit 1
    }
    Show-ContextSummary

    # Safety checkpoint
    git stash push -m "ralph-pre-implement-$(Get-Date -Format 'yyyyMMddHHmmss')" --include-untracked 2>$null

    $iteration = 0

    # Pre-loop check: are there any features to work on?
    try {
        $features = Get-Content "feature_list.json" -Raw | ConvertFrom-Json
        $remaining = @($features.features | Where-Object { $_.status -eq "pending" -or $_.status -eq "in_progress" }).Count
        if ($remaining -eq 0) {
            $blockedCount = @($features.features | Where-Object { $_.status -eq "blocked" }).Count
            if ($blockedCount -gt 0) {
                Write-RalphWarning "No pending features, but $blockedCount feature(s) are blocked"
                Write-RalphInfo "Fix blocked features in feature_list.json and re-run"
                return 2
            }
            else {
                Write-RalphSuccess "All features are already complete! Nothing to do."
                return 0
            }
        }
        Write-RalphInfo "$remaining feature(s) remaining to implement"
    }
    catch {
        Write-RalphError "Failed to read feature_list.json: $_"
        return 1
    }

    while ($iteration -lt $script:MAX_IMPLEMENT_ITERATIONS) {
        Write-Host ""
        Write-Host "--- Implementation Iteration $($iteration + 1) of $script:MAX_IMPLEMENT_ITERATIONS ---" -ForegroundColor Cyan
        Write-Host "    $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
        Write-DebugLog "Implementation iteration $($iteration + 1) starting"
        Write-Host ""

        # Windows NUL file cleanup: Claude Code on Windows can create a literal 'nul' file
        # (Windows reserved device name) which breaks git operations. Remove it if present.
        if (Test-Path "nul" -ErrorAction SilentlyContinue) {
            Remove-Item "nul" -Force -ErrorAction SilentlyContinue
            Write-DebugLog "Removed stale 'nul' file (Windows Claude Code bug)"
        }

        # Build the prompt
        $implPromptPath = Join-Path $PromptsDir "implementer.md"
        Write-DebugLog "Loading prompt from: $implPromptPath"

        if (-not (Test-Path $implPromptPath)) {
            Write-RalphError "Prompt file not found: $implPromptPath"
            return 1
        }

        $implPrompt = Get-Content $implPromptPath -Raw
        Write-DebugLog "Prompt loaded: $($implPrompt.Length) chars, first 100: $($implPrompt.Substring(0, [Math]::Min(100, $implPrompt.Length)))"

        # Run Claude (capture exit code)
        $exitCode = Invoke-Claude -Prompt $implPrompt

        if ($exitCode -ne 0) {
            Write-RalphWarning "Claude exited with code $exitCode"
            Write-DebugLog "Claude exited with code $exitCode"
        }

        # Safety net: recalculate .stats from actual feature statuses
        # (in case Claude edited feature_list.json directly instead of using companion scripts)
        Repair-FeatureStats

        # Data-driven completion check: query feature_list.json directly
        try {
            $features = Get-Content "feature_list.json" -Raw | ConvertFrom-Json
            $total        = @($features.features).Count
            $complete     = @($features.features | Where-Object { $_.status -eq "complete" }).Count
            $remaining    = @($features.features | Where-Object { $_.status -eq "pending" -or $_.status -eq "in_progress" }).Count
            $blockedCount = @($features.features | Where-Object { $_.status -eq "blocked" }).Count
        }
        catch {
            Write-RalphWarning "Failed to parse feature_list.json: $_"
            $total = 0
            $complete = 0
            $remaining = -1
            $blockedCount = 0
        }

        Write-DebugLog "Status: $complete/$total complete, $remaining remaining, $blockedCount blocked"

        # Sanity check: if total is 0, feature_list.json is corrupted
        if ($total -eq 0) {
            Write-RalphWarning "feature_list.json appears corrupted (0 features found). Stopping loop."
            Write-RalphInfo "Check feature_list.json for valid JSON structure."
            return 1
        }

        # All features complete (none pending or in_progress, none blocked)
        if ($remaining -eq 0 -and $blockedCount -eq 0) {
            Write-Host ""
            Write-Host "==================================================================" -ForegroundColor Green
            Write-Host "||  ALL FEATURES COMPLETE!  ($complete/$total)" -ForegroundColor Green
            Write-Host "||     Total iterations: $($iteration + 1)" -ForegroundColor Green
            Write-Host "==================================================================" -ForegroundColor Green
            Write-Host ""
            Write-DebugLog "ALL FEATURES COMPLETE after $($iteration + 1) iterations"
            return 0
        }

        # No work left but some features are blocked
        if ($remaining -eq 0 -and $blockedCount -gt 0) {
            Write-Host ""
            Write-Host "==================================================================" -ForegroundColor Yellow
            Write-Host "||  BLOCKED - Human intervention needed" -ForegroundColor Yellow
            Write-Host "||     $complete/$total complete, $blockedCount blocked" -ForegroundColor Yellow
            Write-Host "||     Check feature_list.json for blocked features" -ForegroundColor Yellow
            Write-Host "==================================================================" -ForegroundColor Yellow
            Write-Host ""
            Write-DebugLog "BLOCKED at iteration $($iteration + 1): $blockedCount features blocked"
            return 2
        }

        $iteration++

        if ($iteration -lt $script:MAX_IMPLEMENT_ITERATIONS) {
            Write-RalphInfo "Progress: $complete/$total complete, $remaining remaining. Next in $script:SLEEP_BETWEEN seconds... (Ctrl+C to stop)"
            Start-Sleep -Seconds $script:SLEEP_BETWEEN
        }
    }

    Write-Host ""
    Write-RalphWarning "Max iterations reached ($script:MAX_IMPLEMENT_ITERATIONS)"
    Write-RalphInfo "Progress: $complete/$total complete, $remaining remaining"
    return 1
}

# ======================================================================
# Auto Mode (All Phases)
# ======================================================================

function Start-Auto {
    Write-Banner

    Write-Host "Running all phases automatically..." -ForegroundColor White
    Write-Host ""
    Write-Host "  Phase 1: Initialize (PRD -> features)"
    Write-Host "  Phase 2: Validate (ensure coverage)"
    Write-Host "  Phase 3: Implement (build features)"
    Write-Host ""
    Write-Host "Press Ctrl+C at any time to stop" -ForegroundColor Yellow
    Start-Sleep -Seconds 3

    # Phase 1: Init (only if feature_list.json doesn't exist)
    if (-not (Test-Path "feature_list.json")) {
        Start-Init
        if ($LASTEXITCODE -ne 0) {
            Write-RalphError "Initialization failed. Stopping."
            exit 1
        }
    }
    else {
        Write-RalphInfo "feature_list.json exists, skipping init phase"
    }

    # Phase 2: Validate (only if not already validated)
    $needsValidation = $true
    if (Test-Path "validation-state.json") {
        try {
            $valState = Get-Content "validation-state.json" -Raw | ConvertFrom-Json
            if ($valState.status -eq "complete") {
                $needsValidation = $false
            }
        }
        catch { }
    }

    if ($needsValidation) {
        $valResult = Start-Validate
        if ($valResult -eq 2) {
            Write-RalphError "Validation blocked. Human review needed."
            exit 2
        }
        elseif ($valResult -ne 0) {
            Write-RalphWarning "Validation incomplete but continuing to implementation..."
        }
    }
    else {
        Write-RalphInfo "Validation already complete, skipping validate phase"
    }

    # Phase 3: Implement
    Start-Implement
}

# ======================================================================
# Status
# ======================================================================

function Show-Status {
    Write-Banner

    Write-Host "PROJECT STATUS" -ForegroundColor White
    Write-Host ""

    # PRD
    if (Test-Path "prd.md") {
        $prdLines = @(Get-Content "prd.md").Count
        Write-RalphSuccess "prd.md exists ($prdLines lines)"
    }
    else {
        Write-RalphError "prd.md not found"
    }

    # Features
    if (Test-Path "feature_list.json") {
        try {
            $features = Get-Content "feature_list.json" -Raw | ConvertFrom-Json
            $total      = @($features.features).Count
            $complete   = @($features.features | Where-Object { $_.status -eq "complete" }).Count
            $inProgress = @($features.features | Where-Object { $_.status -eq "in_progress" }).Count
            $blocked    = @($features.features | Where-Object { $_.status -eq "blocked" }).Count
            $pending    = @($features.features | Where-Object { $_.status -eq "pending" }).Count

            Write-RalphSuccess "feature_list.json exists"
            Write-Host ""
            Write-Host "  Features:"
            Write-Host "    Total:       $total"
            Write-Host "    Complete:    " -NoNewline; Write-Host "$complete" -ForegroundColor Green
            Write-Host "    In Progress: " -NoNewline; Write-Host "$inProgress" -ForegroundColor Yellow
            Write-Host "    Pending:     " -NoNewline; Write-Host "$pending" -ForegroundColor Blue
            Write-Host "    Blocked:     " -NoNewline; Write-Host "$blocked" -ForegroundColor Red

            if ($total -gt 0) {
                $percent = [math]::Floor(($complete / $total) * 100)
                Write-Host ""
                Write-Host "  Progress: $percent%"
            }
        }
        catch {
            Write-RalphError "feature_list.json exists but could not be parsed"
        }
    }
    else {
        Write-RalphWarning "feature_list.json not found (run .\ralph.ps1 init)"
    }

    Write-Host ""

    # Validation
    if (Test-Path "validation-state.json") {
        try {
            $valState = Get-Content "validation-state.json" -Raw | ConvertFrom-Json
            Write-RalphSuccess "validation-state.json exists"
            Write-Host "    Coverage: $($valState.coverage_percent)%"
            Write-Host "    Status:   $($valState.status)"
        }
        catch {
            Write-RalphError "validation-state.json exists but could not be parsed"
        }
    }
    else {
        Write-RalphWarning "validation-state.json not found (run .\ralph.ps1 validate)"
    }

    Write-Host ""

    # Progress log
    if (Test-Path "claude-progress.txt") {
        $progressLines = @(Get-Content "claude-progress.txt").Count
        Write-RalphSuccess "claude-progress.txt exists ($progressLines lines)"
    }
    else {
        Write-RalphWarning "claude-progress.txt not found"
    }

    Write-Host ""

    # Next action
    Write-Host "NEXT ACTION" -ForegroundColor White
    if (-not (Test-Path "prd.md")) {
        Write-Host "  -> Create prd.md with your requirements"
    }
    elseif (-not (Test-Path "feature_list.json")) {
        Write-Host "  -> Run: .\ralph.ps1 init"
    }
    elseif (-not (Test-Path "validation-state.json") -or
            ((Get-Content "validation-state.json" -Raw | ConvertFrom-Json).status -ne "complete")) {
        Write-Host "  -> Run: .\ralph.ps1 validate"
    }
    elseif ($blocked -gt 0 -and $pending -eq 0 -and $inProgress -eq 0) {
        Write-Host "  -> $blocked feature(s) blocked. Fix in feature_list.json, then: .\ralph.ps1 run"
    }
    elseif ($pending -gt 0 -or $inProgress -gt 0) {
        Write-Host "  -> Run: .\ralph.ps1 run"
    }
    else {
        Write-Host "  -> All done!"
    }

    Write-Host ""
}

# ======================================================================
# Main
# ======================================================================

switch ($Command) {
    'author'    { Start-Author }
    'init'      { Start-Init }
    'validate'  { Start-Validate }
    'run'       { Start-Implement }
    'implement' { Start-Implement }
    'auto'      { Start-Auto }
    'status'    { Show-Status }
    'help'      { Show-Help }
    default     { Show-Help }
}
