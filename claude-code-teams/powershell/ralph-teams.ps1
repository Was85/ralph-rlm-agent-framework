#Requires -Version 5.1
<#
.SYNOPSIS
    Ralph-RLM-Framework v2.0 Teams Edition (Claude Code CLI - PowerShell)
    Based on Geoffrey Huntley's Ralph Wiggum technique

.DESCRIPTION
    Three-phase autonomous development with parallel team implementation:
      Phase 1: Initialize - PRD -> feature_list.json
      Phase 2: Validate   - Ensure PRD fully covered (loops)
      Phase 3: Implement  - Build features in parallel (agent teams)

.EXAMPLE
    .\ralph-teams.ps1 init                # Phase 1: Create features from PRD
    .\ralph-teams.ps1 validate            # Phase 2: Validate PRD coverage
    .\ralph-teams.ps1 run                 # Phase 3: Implement with agent teams
    .\ralph-teams.ps1 run -Teammates 5    # Phase 3: 5 implementers in parallel
    .\ralph-teams.ps1 auto                # All phases automatically
    .\ralph-teams.ps1 status              # Show current state
    .\ralph-teams.ps1 help                # Show this help

.NOTES
    Requires: Claude Code CLI (npm install -g @anthropic-ai/claude-code)
    Phases 1 & 2 are identical to the sequential variant (ralph.ps1).
    Phase 3 replaces the PS loop with Claude Code agent teams.
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

    [int]$Teammates = 3,

    [switch]$SkipReview,

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
$script:TEAMMATES = $Teammates
$script:WITH_REVIEWER = -not $SkipReview.IsPresent
$script:LOG_FILE = "ralph-debug.log"

# ======================================================================
# Colors & Formatting
# ======================================================================

function Write-Banner {
    Write-Host ""
    Write-Host "==================================================================" -ForegroundColor Blue
    Write-Host "||  " -ForegroundColor Blue -NoNewline
    Write-Host "RALPH-RLM FRAMEWORK v2.0 TEAMS" -ForegroundColor White -NoNewline
    Write-Host "                            ||" -ForegroundColor Blue
    Write-Host "||  " -ForegroundColor Blue -NoNewline
    Write-Host "Claude Code CLI + Agent Teams (PowerShell)" -ForegroundColor Cyan -NoNewline
    Write-Host "                ||" -ForegroundColor Blue
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

    # Stream JSON output (requires --verbose when using -p)
    if ($script:STREAM_OUTPUT) {
        if ($flags -notcontains "--verbose" -and $flags -notcontains "--debug") {
            $flags += "--verbose"
        }
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

    # Team info
    Write-Host "  Team config: $script:TEAMMATES implementers" -ForegroundColor White -NoNewline
    if ($script:WITH_REVIEWER) {
        Write-Host " + 1 reviewer" -ForegroundColor White
    }
    else {
        Write-Host " (no reviewer)" -ForegroundColor Yellow
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
    Write-Host "  .\ralph-teams.ps1 <command> [options]"
    Write-Host ""

    Write-Host "COMMANDS" -ForegroundColor White
    Write-Host "  author      Interactive PRD creation assistant"
    Write-Host "  init        Phase 1: Analyze PRD and create feature_list.json"
    Write-Host "  validate    Phase 2: Validate all PRD requirements are covered (loops)"
    Write-Host "  run         Phase 3: Implement features in parallel (agent teams)"
    Write-Host "  auto        Run all phases automatically"
    Write-Host "  status      Show current project state"
    Write-Host "  help        Show this help message"
    Write-Host ""

    Write-Host "FLAGS" -ForegroundColor White
    Write-Host "  -MaxIterations, -m N              Max implementation iterations (default: 50)"
    Write-Host "  -MaxValidateIterations N          Max validation iterations (default: 10)"
    Write-Host "  -CoverageThreshold, -c N          Required PRD coverage % (default: 95)"
    Write-Host "  -SleepBetween, -s N               Seconds between iterations (default: 2)"
    Write-Host "  -Teammates N                      Number of parallel implementer agents (default: 3)"
    Write-Host "  -SkipReview                       Skip per-feature code review (faster, less safe)"
    Write-Host "  -VerboseOutput, -v                Show context summary and RLM debug info"
    Write-Host "  -DebugMode                        Enable Claude Code debug-level tracing (implies -VerboseOutput)"
    Write-Host "  -DangerouslySkipPermissions       Full tool access with deny rules (less safe, faster)"
    Write-Host "  -Stream                           Stream Claude Code output as JSON (for CI/automation)"
    Write-Host ""

    Write-Host "WORKFLOW" -ForegroundColor White
    Write-Host ""
    Write-Host "  +-------------+     +-------------+     +-----------------+"
    Write-Host "  |   prd.md    | --> |  INIT       | --> |  VALIDATE       |"
    Write-Host "  | (you write) |     |  (once)     |     |  (loops)        |"
    Write-Host "  +-------------+     +-------------+     +--------+--------+"
    Write-Host "                                                   |"
    Write-Host "                                                   v"
    Write-Host "                                          +-----------------+"
    Write-Host "                                          |  TEAM IMPLEMENT |"
    Write-Host "                                          |  (parallel)     |"
    Write-Host "                                          +-----------------+"
    Write-Host "                                          | Lead + N impl.  |"
    Write-Host "                                          | + 1 reviewer    |"
    Write-Host "                                          +-----------------+"
    Write-Host ""

    Write-Host "QUICK START" -ForegroundColor White
    Write-Host "  1. Run: .\ralph-teams.ps1 author    (get help writing your PRD)"
    Write-Host "  2. Write your requirements in prd.md"
    Write-Host "  3. Run: .\ralph-teams.ps1 auto"
    Write-Host "  4. Go make coffee"
    Write-Host ""

    Write-Host "EXAMPLES" -ForegroundColor White
    Write-Host "  .\ralph-teams.ps1 auto                                            # Run everything (3 implementers + reviewer)"
    Write-Host "  .\ralph-teams.ps1 auto -Teammates 5                               # Run with 5 parallel implementers"
    Write-Host "  .\ralph-teams.ps1 run -Teammates 2 -SkipReview                    # Fast mode: 2 implementers, no review"
    Write-Host "  .\ralph-teams.ps1 auto -v                                         # Run with context summary"
    Write-Host "  .\ralph-teams.ps1 run -DangerouslySkipPermissions                 # Full tool access"
    Write-Host "  .\ralph-teams.ps1 auto -DangerouslySkipPermissions -DebugMode     # Full access + debug tracing"
    Write-Host ""

    Write-Host "FILES" -ForegroundColor White
    Write-Host "  prd.md                Your requirements (input)"
    Write-Host "  feature_list.json     Generated features with status"
    Write-Host "  validation-state.json Validation coverage tracking"
    Write-Host "  claude-progress.txt   Detailed iteration log"
    Write-Host ""

    Write-Host "FRAMEWORK DIRECTORIES" -ForegroundColor White
    Write-Host "  .claude\skills\       Auto-discovered skill definitions and scripts"
    Write-Host "  .claude\skills\ralph\ Core Ralph loop skills (with mutex locking)"
    Write-Host "  .claude\rules\        Auto-loaded coding rules (by file pattern)"
    Write-Host ""

    Write-Host "DIFFERENCES FROM SEQUENTIAL (ralph.ps1)" -ForegroundColor White
    Write-Host "  - Phase 3 uses agent teams instead of a PowerShell loop"
    Write-Host "  - Multiple features implemented simultaneously"
    Write-Host "  - Named mutex protects feature_list.json from concurrent writes"
    Write-Host "  - claim-feature.ps1 prevents double-claiming"
    Write-Host "  - Mandatory per-feature code review (unless -SkipReview)"
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
                Write-Host "       Run '.\ralph-teams.ps1 init' first." -ForegroundColor Gray
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
                Write-Host "       Run '.\ralph-teams.ps1 init' first." -ForegroundColor Gray
                return $false
            }
            Write-RalphSuccess "feature_list.json found"

            $teamLeadPrompt = Join-Path $PromptsDir "team-lead.md"
            if (-not (Test-Path $teamLeadPrompt)) {
                Write-RalphError "team-lead.md not found!"
                return $false
            }
            Write-RalphSuccess "team-lead.md found"

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

    # Write prompt to a temp file and tell Claude to read it.
    # PowerShell 5.1 splits multi-line strings into separate arguments
    # when passing to native commands via splatting. Lines starting with
    # - or -- get misinterpreted as CLI flags. Writing to a file and
    # passing a short "read this file" instruction avoids this entirely.
    $tempFile = Join-Path (Get-Location).Path ".ralph-prompt-temp.md"
    [System.IO.File]::WriteAllText($tempFile, $Prompt, (New-Object System.Text.UTF8Encoding $false))

    Write-DebugLog "Running claude with prompt from $tempFile ($($Prompt.Length) chars)"

    try {
        $shortPrompt = "Read the file .ralph-prompt-temp.md in the current directory and follow ALL instructions in it exactly. Do not skip any steps."

        $allArgs = @()
        $allArgs += $flags
        $allArgs += "-p"
        $allArgs += $shortPrompt

        & claude @allArgs
    }
    finally {
        Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
    }

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

    $suffix = "`nYou are helping the user create a prd.md for Ralph-RLM-Framework.`n"
    $suffix += "If a prd.md template exists at templates\prd.md, use it as the output structure.`n"
    $suffix += "Guide the user through each phase described above.`n"
    $suffix += "Save the final result as prd.md in the current directory.`n"
    $suffix += "Start by asking the user about their project (Phase 1: Project Understanding).`n"

    $fullPrompt = "$skillContent`n$suffix"
    $authorTempFile = Join-Path (Get-Location).Path ".ralph-author-prompt.md"
    [System.IO.File]::WriteAllText($authorTempFile, $fullPrompt, (New-Object System.Text.UTF8Encoding $false))

    # Use interactive mode (no -p flag) so the user can answer questions
    $shortPrompt = "Read the file .ralph-author-prompt.md in the current directory and follow ALL instructions in it exactly."
    $flags = Get-ClaudeFlags
    if ($flags.Count -gt 0) {
        & claude @flags $shortPrompt
    }
    else {
        & claude $shortPrompt
    }

    # Clean up temp file
    Remove-Item $authorTempFile -Force -ErrorAction SilentlyContinue

    if (Test-Path "prd.md") {
        Write-Host ""
        Write-RalphSuccess "prd.md created successfully!"
        Write-Host ""
        Write-Host "Next steps:"
        Write-Host "  1. Review prd.md"
        Write-Host "  2. Run: .\ralph-teams.ps1 auto"
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
            Write-Host "Next step: .\ralph-teams.ps1 validate"
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
                    Write-Host "Next step: .\ralph-teams.ps1 run"
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
# Post-Run Report
# ======================================================================

function Show-PostRunReport {
    <#
    .SYNOPSIS
        Display a detailed post-run report after Phase 3 completes.
        Shows completed, blocked, and in-progress features with details.
    #>
    if (-not (Test-Path "feature_list.json")) {
        return
    }

    try {
        $data = Get-Content "feature_list.json" -Raw | ConvertFrom-Json
    }
    catch {
        Write-RalphWarning "Could not parse feature_list.json for report"
        return
    }

    $total      = @($data.features).Count
    $complete   = @($data.features | Where-Object { $_.status -eq "complete" })
    $blocked    = @($data.features | Where-Object { $_.status -eq "blocked" })
    $inProgress = @($data.features | Where-Object { $_.status -eq "in_progress" })
    $pending    = @($data.features | Where-Object { $_.status -eq "pending" })

    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host "  POST-RUN REPORT" -ForegroundColor White
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host ""

    # Summary bar
    $completeCount = $complete.Count
    $blockedCount = $blocked.Count
    $inProgressCount = $inProgress.Count
    $pendingCount = $pending.Count
    $percent = 0
    if ($total -gt 0) { $percent = [math]::Floor(($completeCount / $total) * 100) }

    Write-Host "  Summary: " -NoNewline
    Write-Host "$completeCount complete" -ForegroundColor Green -NoNewline
    Write-Host " | " -NoNewline
    Write-Host "$inProgressCount in-progress" -ForegroundColor Yellow -NoNewline
    Write-Host " | " -NoNewline
    Write-Host "$pendingCount pending" -ForegroundColor Blue -NoNewline
    Write-Host " | " -NoNewline
    Write-Host "$blockedCount blocked" -ForegroundColor Red -NoNewline
    Write-Host "  ($percent% done)"
    Write-Host ""

    # Completed features
    if ($completeCount -gt 0) {
        Write-Host "  COMPLETED ($completeCount)" -ForegroundColor Green
        foreach ($f in $complete) {
            $claimedBy = "-"
            if ($f.claimed_by) { $claimedBy = $f.claimed_by }
            $attempts = 1
            if ($f.attempts) { $attempts = $f.attempts }
            Write-Host "    $($f.id): $($f.description)" -ForegroundColor Gray -NoNewline
            Write-Host "  [by: $claimedBy, attempts: $attempts]" -ForegroundColor DarkGray
        }
        Write-Host ""
    }

    # Blocked features
    if ($blockedCount -gt 0) {
        Write-Host "  BLOCKED ($blockedCount)" -ForegroundColor Red
        foreach ($f in $blocked) {
            $claimedBy = "-"
            if ($f.claimed_by) { $claimedBy = $f.claimed_by }
            $lastError = "-"
            if ($f.last_error) {
                $lastError = $f.last_error
                if ($lastError.Length -gt 80) { $lastError = $lastError.Substring(0, 77) + "..." }
            }
            Write-Host "    $($f.id): $($f.description)" -ForegroundColor Gray
            Write-Host "      by: $claimedBy | error: $lastError" -ForegroundColor DarkGray
        }
        Write-Host ""
    }

    # In-progress features (may indicate crashed teammates)
    if ($inProgressCount -gt 0) {
        Write-Host "  IN-PROGRESS ($inProgressCount) - may indicate crashed teammates" -ForegroundColor Yellow
        foreach ($f in $inProgress) {
            $claimedBy = "-"
            if ($f.claimed_by) { $claimedBy = $f.claimed_by }
            Write-Host "    $($f.id): $($f.description)" -ForegroundColor Gray -NoNewline
            Write-Host "  [claimed by: $claimedBy]" -ForegroundColor DarkGray
        }
        Write-Host ""
    }

    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host ""
}

# ======================================================================
# Live Progress Snapshot
# ======================================================================

function Show-ImplementProgress {
    <#
    .SYNOPSIS
        Print a one-line progress snapshot from feature_list.json.
        Called before/after each iteration for visibility.
    #>
    if (-not (Test-Path "feature_list.json")) { return }

    try {
        $data = Get-Content "feature_list.json" -Raw | ConvertFrom-Json
        $total      = @($data.features).Count
        $complete   = @($data.features | Where-Object { $_.status -eq "complete" }).Count
        $inProgress = @($data.features | Where-Object { $_.status -eq "in_progress" })
        $blocked    = @($data.features | Where-Object { $_.status -eq "blocked" }).Count
        $pending    = @($data.features | Where-Object { $_.status -eq "pending" }).Count

        $ts = Get-Date -Format "HH:mm:ss"
        $percent = 0
        if ($total -gt 0) { $percent = [math]::Floor(($complete / $total) * 100) }

        # Build active workers string
        $workers = ""
        if ($inProgress.Count -gt 0) {
            $workerParts = @()
            foreach ($f in $inProgress) {
                $who = if ($f.claimed_by) { $f.claimed_by } else { "?" }
                $workerParts += "$($who):$($f.id)"
            }
            $workers = " | active: $($workerParts -join ', ')"
        }

        Write-Host "[$ts] " -ForegroundColor DarkGray -NoNewline
        Write-Host "$complete/$total" -ForegroundColor Green -NoNewline
        Write-Host " complete ($percent%)" -NoNewline
        Write-Host " | " -NoNewline
        Write-Host "$($inProgress.Count) in-progress" -ForegroundColor Yellow -NoNewline
        Write-Host " | " -NoNewline
        Write-Host "$pending pending" -ForegroundColor Blue -NoNewline
        Write-Host " | " -NoNewline
        Write-Host "$blocked blocked" -ForegroundColor Red -NoNewline
        Write-Host "$workers" -ForegroundColor DarkGray
    }
    catch {
        Write-DebugLog "Show-ImplementProgress failed: $_"
    }
}

# ======================================================================
# Phase 3: Team Implement (Agent Teams)
# ======================================================================

function Start-TeamImplement {
    Write-Phase "PHASE 3: IMPLEMENT FEATURES (AGENT TEAMS)"
    Write-Host "Implementing features in parallel with $script:TEAMMATES implementers..."
    if ($script:WITH_REVIEWER) {
        Write-Host "Per-feature code review: ENABLED" -ForegroundColor Green
    }
    else {
        Write-Host "Per-feature code review: DISABLED (SkipReview)" -ForegroundColor Yellow
    }
    Write-Host ""

    if (-not (Test-Preflight 'run')) {
        exit 1
    }
    Show-ContextSummary

    # Safety checkpoint
    git stash push -m "ralph-pre-team-implement-$(Get-Date -Format 'yyyyMMddHHmmss')" --include-untracked 2>$null

    # Pre-check: are there any features to work on?
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

    $phaseStart = Get-Date
    $iteration = 0

    while ($iteration -lt $script:MAX_IMPLEMENT_ITERATIONS) {
        # Windows NUL file cleanup
        if (Test-Path "nul" -ErrorAction SilentlyContinue) {
            Remove-Item "nul" -Force -ErrorAction SilentlyContinue
            Write-DebugLog "Removed stale 'nul' file (Windows Claude Code bug)"
        }

        # Check remaining features at top of each iteration
        try {
            $features = Get-Content "feature_list.json" -Raw | ConvertFrom-Json
            $remaining    = @($features.features | Where-Object { $_.status -eq "pending" -or $_.status -eq "in_progress" }).Count
            $total        = @($features.features).Count
            $complete     = @($features.features | Where-Object { $_.status -eq "complete" }).Count
            $blockedCount = @($features.features | Where-Object { $_.status -eq "blocked" }).Count
        }
        catch {
            Write-RalphWarning "Failed to parse feature_list.json: $_"
            $iteration++
            continue
        }

        # Exit conditions
        if ($remaining -eq 0 -and $blockedCount -eq 0) {
            Write-Host ""
            Write-Host "==================================================================" -ForegroundColor Green
            Write-Host "||  ALL FEATURES COMPLETE!  ($complete/$total)" -ForegroundColor Green
            Write-Host "==================================================================" -ForegroundColor Green
            Write-Host ""
            $phaseElapsed = (Get-Date) - $phaseStart
            Write-RalphInfo "Phase 3 elapsed: $($phaseElapsed.ToString('hh\:mm\:ss')) ($($iteration) iteration(s))"
            Show-PostRunReport
            return 0
        }

        if ($remaining -eq 0 -and $blockedCount -gt 0) {
            Write-Host ""
            Write-Host "==================================================================" -ForegroundColor Yellow
            Write-Host "||  BLOCKED - Human intervention needed" -ForegroundColor Yellow
            Write-Host "||     $complete/$total complete, $blockedCount blocked" -ForegroundColor Yellow
            Write-Host "==================================================================" -ForegroundColor Yellow
            Write-Host ""
            $phaseElapsed = (Get-Date) - $phaseStart
            Write-RalphInfo "Phase 3 elapsed: $($phaseElapsed.ToString('hh\:mm\:ss')) ($($iteration) iteration(s))"
            Show-PostRunReport
            return 2
        }

        # Iteration header
        Write-Host ""
        Write-Host "--- Implementation Iteration $($iteration + 1) of $script:MAX_IMPLEMENT_ITERATIONS ---" -ForegroundColor Cyan
        Write-DebugLog "Implementation iteration $($iteration + 1) starting ($remaining remaining)"
        Write-Host ""

        # Progress snapshot (before)
        Show-ImplementProgress

        # Build the team-lead prompt with current state
        $teamLeadPromptPath = Join-Path $PromptsDir "team-lead.md"
        $teamLeadPrompt = Get-Content $teamLeadPromptPath -Raw

        $config = "`n## Configuration`n"
        $config += "- Teammates: $script:TEAMMATES`n"
        $config += "- WithReviewer: $script:WITH_REVIEWER`n"
        $config += "- Remaining features: $remaining`n"
        $config += "- Prompts directory: $PromptsDir`n"
        $config += "- Working directory: $(Get-Location)`n"
        $config += "- Iteration: $($iteration + 1) of $script:MAX_IMPLEMENT_ITERATIONS`n"

        $fullPrompt = "$teamLeadPrompt`n$config"

        Write-RalphInfo "Launching team lead agent..."
        Write-RalphInfo "The team lead will spawn $script:TEAMMATES implementer teammates"
        if ($script:WITH_REVIEWER) {
            Write-RalphInfo "A reviewer teammate will review each feature before marking it complete"
        }
        Write-Host ""

        $iterStart = Get-Date

        # Run team lead via Invoke-Claude (-p mode).
        # Claude in -p mode can still use TeamCreate, Task, SendMessage etc.
        # through multi-turn tool usage. It runs the full workflow and exits.
        Invoke-Claude -Prompt $fullPrompt

        $iterElapsed = (Get-Date) - $iterStart

        # Post-iteration: repair stats and show progress
        Repair-FeatureStats

        Write-Host ""
        Write-RalphInfo "Iteration $($iteration + 1) elapsed: $($iterElapsed.ToString('hh\:mm\:ss'))"

        # Progress snapshot (after)
        Show-ImplementProgress

        $iteration++

        if ($iteration -lt $script:MAX_IMPLEMENT_ITERATIONS) {
            Write-RalphInfo "Checking for remaining features..."
            Start-Sleep -Seconds $script:SLEEP_BETWEEN
        }
    }

    # Max iterations reached
    Write-Host ""
    Write-RalphWarning "Max implementation iterations reached ($script:MAX_IMPLEMENT_ITERATIONS)"
    $phaseElapsed = (Get-Date) - $phaseStart
    Write-RalphInfo "Phase 3 elapsed: $($phaseElapsed.ToString('hh\:mm\:ss')) ($iteration iteration(s))"
    Repair-FeatureStats
    Show-PostRunReport

    try {
        $features = Get-Content "feature_list.json" -Raw | ConvertFrom-Json
        $total        = @($features.features).Count
        $complete     = @($features.features | Where-Object { $_.status -eq "complete" }).Count
        $remaining    = @($features.features | Where-Object { $_.status -eq "pending" -or $_.status -eq "in_progress" }).Count
        $blockedCount = @($features.features | Where-Object { $_.status -eq "blocked" }).Count
    }
    catch {
        Write-RalphWarning "Failed to parse feature_list.json: $_"
        return 1
    }

    Write-RalphInfo "Final: $complete/$total complete, $remaining remaining, $blockedCount blocked"
    return 1
}

# ======================================================================
# Auto Mode (All Phases)
# ======================================================================

function Start-Auto {
    Write-Banner

    $autoStart = Get-Date

    Write-Host "Running all phases automatically..." -ForegroundColor White
    Write-Host ""
    Write-Host "  Phase 1: Initialize (PRD -> features)"
    Write-Host "  Phase 2: Validate (ensure coverage)"
    Write-Host "  Phase 3: Team Implement ($script:TEAMMATES parallel implementers)"
    if ($script:WITH_REVIEWER) {
        Write-Host "           + per-feature code review"
    }
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

    # Phase 3: Team Implement
    $implResult = Start-TeamImplement

    $autoElapsed = (Get-Date) - $autoStart
    Write-Host ""

    if ($implResult -eq 0) {
        Write-Host "================================================================" -ForegroundColor Green
        Write-Host "  RALPH COMPLETE - All features implemented successfully" -ForegroundColor Green
        Write-Host "  Total elapsed: $($autoElapsed.ToString('hh\:mm\:ss'))" -ForegroundColor White
        Write-Host "================================================================" -ForegroundColor Green
    }
    elseif ($implResult -eq 2) {
        Write-Host "================================================================" -ForegroundColor Yellow
        Write-Host "  RALPH BLOCKED - Some features need human intervention" -ForegroundColor Yellow
        Write-Host "  Total elapsed: $($autoElapsed.ToString('hh\:mm\:ss'))" -ForegroundColor White
        Write-Host "================================================================" -ForegroundColor Yellow
    }
    else {
        Write-Host "================================================================" -ForegroundColor Red
        Write-Host "  RALPH INCOMPLETE - Features remain after max iterations" -ForegroundColor Red
        Write-Host "  Total elapsed: $($autoElapsed.ToString('hh\:mm\:ss'))" -ForegroundColor White
        Write-Host "  Re-run: .\ralph-teams.ps1 run" -ForegroundColor Gray
        Write-Host "================================================================" -ForegroundColor Red
    }

    Write-Host ""
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

            # Show claimed_by info if any
            $claimed = @($features.features | Where-Object { $_.claimed_by }).Count
            if ($claimed -gt 0) {
                Write-Host ""
                Write-Host "  Claimed by teammates: $claimed"
                $features.features | Where-Object { $_.claimed_by } | ForEach-Object {
                    Write-Host "    $($_.id): $($_.claimed_by) ($($_.status))" -ForegroundColor Gray
                }
            }
        }
        catch {
            Write-RalphError "feature_list.json exists but could not be parsed"
        }
    }
    else {
        Write-RalphWarning "feature_list.json not found (run .\ralph-teams.ps1 init)"
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
        Write-RalphWarning "validation-state.json not found (run .\ralph-teams.ps1 validate)"
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
        Write-Host "  -> Run: .\ralph-teams.ps1 init"
    }
    elseif (-not (Test-Path "validation-state.json") -or
            ((Get-Content "validation-state.json" -Raw | ConvertFrom-Json).status -ne "complete")) {
        Write-Host "  -> Run: .\ralph-teams.ps1 validate"
    }
    elseif ($blocked -gt 0 -and $pending -eq 0 -and $inProgress -eq 0) {
        Write-Host "  -> $blocked feature(s) blocked. Fix in feature_list.json, then: .\ralph-teams.ps1 run"
    }
    elseif ($pending -gt 0 -or $inProgress -gt 0) {
        Write-Host "  -> Run: .\ralph-teams.ps1 run"
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
    'run'       { Start-TeamImplement }
    'implement' { Start-TeamImplement }
    'auto'      { Start-Auto }
    'status'    { Show-Status }
    'help'      { Show-Help }
    default     { Show-Help }
}
