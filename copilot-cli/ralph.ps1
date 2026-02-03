#Requires -Version 7.0
<#
.SYNOPSIS
    Ralph-RLM-Framework v2.0 (GitHub Copilot CLI Edition - PowerShell)
    Based on Geoffrey Huntley's Ralph Wiggum technique

.DESCRIPTION
    Three-phase autonomous development:
      Phase 1: Initialize - PRD → feature_list.json
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
    Requires: GitHub Copilot CLI (npm install -g @github/copilot)
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

    [switch]$AllowAllTools
)

# ══════════════════════════════════════════════════════════════
# Script Directory (for finding prompts)
# ══════════════════════════════════════════════════════════════

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PromptsDir = Join-Path $ScriptDir "prompts"
$SkillsDir = Join-Path $ScriptDir "skills"

# ══════════════════════════════════════════════════════════════
# Configuration
# ══════════════════════════════════════════════════════════════

$script:MAX_VALIDATE_ITERATIONS = $MaxValidateIterations
$script:MAX_IMPLEMENT_ITERATIONS = $MaxIterations
$script:SLEEP_BETWEEN = $SleepBetween
$script:COVERAGE_THRESHOLD = $CoverageThreshold
$script:AllowAllToolsFlag = $AllowAllTools

# ══════════════════════════════════════════════════════════════
# Colors & Formatting
# ══════════════════════════════════════════════════════════════

function Write-Banner {
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Magenta
    Write-Host "║  " -ForegroundColor Magenta -NoNewline
    Write-Host "RALPH-RLM FRAMEWORK v2.0" -ForegroundColor White -NoNewline
    Write-Host "                                   ║" -ForegroundColor Magenta
    Write-Host "║  " -ForegroundColor Magenta -NoNewline
    Write-Host "GitHub Copilot CLI Edition (PowerShell)" -ForegroundColor Cyan -NoNewline
    Write-Host "                  ║" -ForegroundColor Magenta
    Write-Host "║  Based on Geoffrey Huntley's Ralph Wiggum technique           ║" -ForegroundColor Magenta
    Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Magenta
    Write-Host ""
}

function Write-Phase {
    param([string]$Text)
    Write-Host ""
    Write-Host "┌──────────────────────────────────────────────────────────────┐" -ForegroundColor Cyan
    Write-Host "│  " -ForegroundColor Cyan -NoNewline
    Write-Host "$Text" -ForegroundColor White
    Write-Host "└──────────────────────────────────────────────────────────────┘" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Success { param([string]$Text) Write-Host "[✓] $Text" -ForegroundColor Green }
function Write-Warning { param([string]$Text) Write-Host "[!] $Text" -ForegroundColor Yellow }
function Write-Error { param([string]$Text) Write-Host "[✗] $Text" -ForegroundColor Red }
function Write-Info { param([string]$Text) Write-Host "[i] $Text" -ForegroundColor Blue }

# ══════════════════════════════════════════════════════════════
# Help
# ══════════════════════════════════════════════════════════════

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
    
    Write-Host "OPTIONS" -ForegroundColor White
    Write-Host "  -MaxIterations, -m N              Max implementation iterations (default: 50)"
    Write-Host "  -MaxValidateIterations N          Max validation iterations (default: 10)"
    Write-Host "  -CoverageThreshold, -c N          Required PRD coverage % (default: 95)"
    Write-Host "  -SleepBetween, -s N               Seconds between iterations (default: 2)"
    Write-Host "  -AllowAllTools                    Skip permission prompts (less safe, faster)"
    Write-Host ""
    
    Write-Host "WORKFLOW" -ForegroundColor White
    Write-Host ""
    Write-Host "  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐"
    Write-Host "  │   prd.md    │ ──► │  INIT       │ ──► │  VALIDATE   │"
    Write-Host "  │ (you write) │     │  (once)     │     │  (loops)    │"
    Write-Host "  └─────────────┘     └─────────────┘     └──────┬──────┘"
    Write-Host "                                                 │"
    Write-Host "                                                 ▼"
    Write-Host "                                          ┌─────────────┐"
    Write-Host "                                          │  IMPLEMENT  │"
    Write-Host "                                          │  (loops)    │"
    Write-Host "                                          └─────────────┘"
    Write-Host ""
    
    Write-Host "QUICK START" -ForegroundColor White
    Write-Host "  1. Run: .\ralph.ps1 author    (get help writing your PRD)"
    Write-Host "  2. Write your requirements in prd.md"
    Write-Host "  3. Run: .\ralph.ps1 auto"
    Write-Host "  4. Go make coffee"
    Write-Host ""
    
    Write-Host "EXAMPLES" -ForegroundColor White
    Write-Host "  .\ralph.ps1 author                        # Get help writing your PRD"
    Write-Host "  .\ralph.ps1 auto                          # Run everything"
    Write-Host "  .\ralph.ps1 init                          # Just create features"
    Write-Host "  .\ralph.ps1 run -m 100                    # Run with max 100 iterations"
    Write-Host "  .\ralph.ps1 run -AllowAllTools            # Fully autonomous (less safe)"
    Write-Host ""

    Write-Host "FRAMEWORK DIRECTORIES" -ForegroundColor White
    Write-Host "  skills\               Modular skill definitions and scripts"
    Write-Host "  skills\ralph\         Core Ralph loop skills"
    Write-Host "  .github\instructions\ Auto-loaded coding instructions (by file pattern)"
    Write-Host ""

    Write-Host "LEARN MORE" -ForegroundColor White
    Write-Host "  Original technique: https://ghuntley.com/ralph/"
    Write-Host "  Copilot CLI docs:   https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli"
    Write-Host ""
}

# ══════════════════════════════════════════════════════════════
# Pre-flight Checks
# ══════════════════════════════════════════════════════════════

function Test-Preflight {
    param([string]$Phase)
    
    Write-Host ""
    Write-Host "Pre-flight checks..." -ForegroundColor Blue
    
    # Check: Git repository
    if (-not (Test-Path ".git")) {
        Write-Error "Not a git repository! Ralph requires git for safety."
        Write-Host "       Run: git init" -ForegroundColor Gray
        return $false
    }
    Write-Success "Git repository detected"
    
    # Check: GitHub Copilot CLI
    $copilotPath = Get-Command "copilot" -ErrorAction SilentlyContinue
    if (-not $copilotPath) {
        Write-Error "GitHub Copilot CLI not found!"
        Write-Host "       Install: npm install -g @github/copilot" -ForegroundColor Gray
        Write-Host "       Then authenticate: copilot" -ForegroundColor Gray
        return $false
    }
    Write-Success "GitHub Copilot CLI found"
    
    # Phase-specific checks
    switch ($Phase) {
        'init' {
            if (-not (Test-Path "prd.md")) {
                Write-Error "prd.md not found!"
                Write-Host "       Create prd.md with your project requirements first." -ForegroundColor Gray
                Write-Host "       See templates\prd.md for an example." -ForegroundColor Gray
                return $false
            }
            Write-Success "prd.md found"
            
            $initPrompt = Join-Path $PromptsDir "initializer.md"
            if (-not (Test-Path $initPrompt)) {
                Write-Error "prompts\initializer.md not found!"
                return $false
            }
            Write-Success "prompts\initializer.md found"
        }
        'validate' {
            if (-not (Test-Path "prd.md")) {
                Write-Error "prd.md not found!"
                return $false
            }
            Write-Success "prd.md found"
            
            if (-not (Test-Path "feature_list.json")) {
                Write-Error "feature_list.json not found!"
                Write-Host "       Run '.\ralph.ps1 init' first." -ForegroundColor Gray
                return $false
            }
            Write-Success "feature_list.json found"
            
            $valPrompt = Join-Path $PromptsDir "validator.md"
            if (-not (Test-Path $valPrompt)) {
                Write-Error "prompts\validator.md not found!"
                return $false
            }
            Write-Success "prompts\validator.md found"
        }
        'run' {
            if (-not (Test-Path "feature_list.json")) {
                Write-Error "feature_list.json not found!"
                Write-Host "       Run '.\ralph.ps1 init' first." -ForegroundColor Gray
                return $false
            }
            Write-Success "feature_list.json found"
            
            $implPrompt = Join-Path $PromptsDir "implementer.md"
            if (-not (Test-Path $implPrompt)) {
                Write-Error "prompts\implementer.md not found!"
                return $false
            }
            Write-Success "prompts\implementer.md found"
            
            if (-not (Test-Path "copilot-progress.txt")) {
                Write-Warning "copilot-progress.txt not found, creating..."
                New-Item -ItemType File -Path "copilot-progress.txt" | Out-Null
            }
            Write-Success "copilot-progress.txt found"
        }
    }
    
    Write-Host ""
    return $true
}

# ══════════════════════════════════════════════════════════════
# Build Copilot CLI flags
# ══════════════════════════════════════════════════════════════

function Get-CopilotFlags {
    $flags = @()

    # Full bypass mode
    if ($script:AllowAllToolsFlag) {
        $flags += "--allow-all-tools"
    }

    # Note: Copilot CLI does not have --verbose/--debug flags

    return $flags
}

# ══════════════════════════════════════════════════════════════
# Run Copilot CLI with prompt
# ══════════════════════════════════════════════════════════════

function Invoke-Copilot {
    param([string]$Prompt)

    $flags = Get-CopilotFlags

    # Build full argument list to avoid PowerShell splatting issues
    $allArgs = @()
    $allArgs += $flags
    $allArgs += "-p"
    $allArgs += $Prompt

    & copilot @allArgs

    return $LASTEXITCODE
}

# ══════════════════════════════════════════════════════════════
# PRD Author (Interactive)
# ══════════════════════════════════════════════════════════════

function Start-Author {
    Write-Phase "PRD AUTHOR"
    Write-Host "Interactive PRD creation assistant..."
    Write-Host ""

    # Check: Git repository
    if (-not (Test-Path ".git")) {
        Write-Error "Not a git repository! Initialize with: git init"
        exit 1
    }

    # Check: Copilot CLI
    $copilotPath = Get-Command "copilot" -ErrorAction SilentlyContinue
    if (-not $copilotPath) {
        Write-Error "GitHub Copilot CLI not found!"
        exit 1
    }

    # Check: PRD Author skill
    $skillFile = Join-Path $SkillsDir "ralph" "prd-author" "SKILL.md"
    if (-not (Test-Path $skillFile)) {
        Write-Error "PRD Author skill not found at: $skillFile"
        exit 1
    }
    Write-Success "PRD Author skill found"

    $skillContent = Get-Content $skillFile -Raw

    $fullPrompt = @"
$skillContent

You are helping the user create a prd.md for Ralph-RLM-Framework.

If a prd.md template exists at templates\prd.md, use it as the output structure.
Guide the user through each phase described above.
Save the final result as prd.md in the current directory.

Start by asking the user about their project (Phase 1: Project Understanding).
"@

    Write-Host ""
    Write-Info "Running PRD Author assistant..."
    Write-Info "This will guide you through creating a high-quality prd.md"
    Write-Host ""

    # Use interactive mode (-i flag) so the user can answer questions
    $flags = Get-CopilotFlags

    # Build full argument list to avoid PowerShell splatting issues
    $allArgs = @()
    $allArgs += "-i"
    $allArgs += $flags
    $allArgs += $fullPrompt

    & copilot @allArgs

    if (Test-Path "prd.md") {
        Write-Host ""
        Write-Success "prd.md created successfully!"
        Write-Host ""
        Write-Host "Next steps:"
        Write-Host "  1. Review prd.md"
        Write-Host "  2. Run: .\ralph.ps1 auto"
    }
    else {
        Write-Warning "prd.md was not created. You can create it manually using templates\prd.md"
    }
}

# ══════════════════════════════════════════════════════════════
# Phase 1: Initialize
# ══════════════════════════════════════════════════════════════

function Start-Init {
    Write-Phase "PHASE 1: INITIALIZE"
    Write-Host "Analyzing PRD and creating feature_list.json..."
    Write-Host ""
    
    if (-not (Test-Preflight 'init')) {
        exit 1
    }
    
    # Create safety checkpoint
    git stash push -m "ralph-pre-init-$(Get-Date -Format 'yyyyMMddHHmmss')" --include-untracked 2>$null
    
    # Build the prompt - tell Copilot to read prd.md instead of embedding content
    $initPromptPath = Join-Path $PromptsDir "initializer.md"
    $initPrompt = Get-Content $initPromptPath -Raw
    
    $fullPrompt = @"
$initPrompt

Read the project requirements from: prd.md
"@
    
    # Run Copilot
    Write-Info "Running initializer agent with Copilot CLI..."
    Write-Host ""
    
    Invoke-Copilot -Prompt $fullPrompt
    
    if (Test-Path "feature_list.json") {
        $features = Get-Content "feature_list.json" | ConvertFrom-Json
        $featureCount = $features.features.Count
        Write-Host ""
        Write-Success "Initialization complete!"
        Write-Info "Created $featureCount features in feature_list.json"
        Write-Host ""
        Write-Host "Next step: .\ralph.ps1 validate"
    }
    else {
        Write-Error "Initialization failed - feature_list.json not created"
        exit 1
    }
}

# ══════════════════════════════════════════════════════════════
# Phase 2: Validate
# ══════════════════════════════════════════════════════════════

function Start-Validate {
    Write-Phase "PHASE 2: VALIDATE PRD COVERAGE"
    Write-Host "Ensuring all requirements are covered by features..."
    Write-Host ""
    
    if (-not (Test-Preflight 'validate')) {
        exit 1
    }
    
    $iteration = 0
    
    # Initialize validation state if not exists
    if (-not (Test-Path "validation-state.json")) {
        @{
            coverage_percent = 0
            iteration = 0
            status = "in_progress"
            gaps = @()
            last_updated = (Get-Date -Format "o")
        } | ConvertTo-Json | Out-File "validation-state.json" -Encoding UTF8
    }
    
    while ($iteration -lt $script:MAX_VALIDATE_ITERATIONS) {
        Write-Host ""
        Write-Host "━━━ Validation Iteration $($iteration + 1) of $script:MAX_VALIDATE_ITERATIONS ━━━" -ForegroundColor Cyan
        Write-Host ""
        
        # Build the prompt - tell Copilot to read files instead of embedding content
        $valPromptPath = Join-Path $PromptsDir "validator.md"
        $valPrompt = Get-Content $valPromptPath -Raw
        
        $fullPrompt = @"
$valPrompt

Read these files from the current directory:
- prd.md (the original PRD)
- feature_list.json (current features)
- validation-state.json (validation state)
"@
        
        # Run Copilot
        Invoke-Copilot -Prompt $fullPrompt
        
        # Check for completion
        if (Test-Path "validation-state.json") {
            $valState = Get-Content "validation-state.json" | ConvertFrom-Json
            $coverage = $valState.coverage_percent
            $status = $valState.status
            
            if ($status -eq "complete" -or $coverage -ge $script:COVERAGE_THRESHOLD) {
                Write-Host ""
                Write-Success "Validation complete! Coverage: $coverage%"
                Write-Host ""
                Write-Host "Next step: .\ralph.ps1 run"
                return 0
            }
            
            if ($status -eq "blocked") {
                Write-Host ""
                Write-Warning "Validation blocked - human review needed"
                Write-Info "Check validation-state.json for details"
                return 2
            }
        }
        
        $iteration++
        
        if ($iteration -lt $script:MAX_VALIDATE_ITERATIONS) {
            Write-Info "Coverage not met. Retrying in $script:SLEEP_BETWEEN seconds..."
            Start-Sleep -Seconds $script:SLEEP_BETWEEN
        }
    }
    
    Write-Host ""
    Write-Warning "Max validation iterations reached ($script:MAX_VALIDATE_ITERATIONS)"
    Write-Info "Check validation-state.json for current coverage"
    return 1
}

# ══════════════════════════════════════════════════════════════
# Phase 3: Implement (Ralph Loop)
# ══════════════════════════════════════════════════════════════

function Start-Implement {
    Write-Phase "PHASE 3: IMPLEMENT FEATURES (RALPH LOOP)"
    Write-Host "Implementing features one by one until complete..."
    Write-Host ""
    
    if (-not (Test-Preflight 'run')) {
        exit 1
    }
    
    # Safety checkpoint
    git stash push -m "ralph-pre-implement-$(Get-Date -Format 'yyyyMMddHHmmss')" --include-untracked 2>$null
    
    $iteration = 0

    # Pre-loop check: are there any features to work on?
    $features = Get-Content "feature_list.json" | ConvertFrom-Json
    $remaining = ($features.features | Where-Object { $_.status -eq "pending" -or $_.status -eq "in_progress" }).Count
    if ($remaining -eq 0) {
        $blockedCount = ($features.features | Where-Object { $_.status -eq "blocked" }).Count
        if ($blockedCount -gt 0) {
            Write-Warning "No pending features, but $blockedCount feature(s) are blocked"
            Write-Info "Fix blocked features in feature_list.json and re-run"
            return 2
        }
        else {
            Write-Success "All features are already complete! Nothing to do."
            return 0
        }
    }
    Write-Info "$remaining feature(s) remaining to implement"

    while ($iteration -lt $script:MAX_IMPLEMENT_ITERATIONS) {
        Write-Host ""
        Write-Host "━━━ Implementation Iteration $($iteration + 1) of $script:MAX_IMPLEMENT_ITERATIONS ━━━" -ForegroundColor Cyan
        Write-Host "    $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
        Write-Host ""

        # Build the prompt
        $implPromptPath = Join-Path $PromptsDir "implementer.md"
        $implPrompt = Get-Content $implPromptPath -Raw

        # Run Copilot
        Invoke-Copilot -Prompt $implPrompt

        $exitCode = $LASTEXITCODE

        if ($exitCode -ne 0) {
            Write-Warning "Copilot exited with code $exitCode"
        }

        # Data-driven completion check: query feature_list.json directly
        $features = Get-Content "feature_list.json" | ConvertFrom-Json
        $total = $features.features.Count
        $complete = ($features.features | Where-Object { $_.status -eq "complete" }).Count
        $remaining = ($features.features | Where-Object { $_.status -eq "pending" -or $_.status -eq "in_progress" }).Count
        $blockedCount = ($features.features | Where-Object { $_.status -eq "blocked" }).Count

        # Sanity check: if total is 0, feature_list.json is corrupted
        if ($total -eq 0) {
            Write-Warning "feature_list.json appears corrupted (0 features found). Stopping loop."
            Write-Info "Check feature_list.json for valid JSON structure."
            return 1
        }

        # All features complete (none pending or in_progress, none blocked)
        if ($remaining -eq 0 -and $blockedCount -eq 0) {
            Write-Host ""
            Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
            Write-Host "║  ALL FEATURES COMPLETE!  ($complete/$total)                       ║" -ForegroundColor Green
            Write-Host "║     Total iterations: $($iteration + 1)                                  ║" -ForegroundColor Green
            Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Green
            Write-Host ""
            return 0
        }

        # No work left but some features are blocked
        if ($remaining -eq 0 -and $blockedCount -gt 0) {
            Write-Host ""
            Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Yellow
            Write-Host "║  BLOCKED - Human intervention needed                         ║" -ForegroundColor Yellow
            Write-Host "║     $complete/$total complete, $blockedCount blocked                              ║" -ForegroundColor Yellow
            Write-Host "║     Check feature_list.json for blocked features                ║" -ForegroundColor Yellow
            Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Yellow
            Write-Host ""
            return 2
        }

        $iteration++

        if ($iteration -lt $script:MAX_IMPLEMENT_ITERATIONS) {
            Write-Info "Progress: $complete/$total complete, $remaining remaining. Next in $script:SLEEP_BETWEEN seconds... (Ctrl+C to stop)"
            Start-Sleep -Seconds $script:SLEEP_BETWEEN
        }
    }

    Write-Host ""
    Write-Warning "Max iterations reached ($script:MAX_IMPLEMENT_ITERATIONS)"
    Write-Info "Progress: $complete/$total complete, $remaining remaining"
    return 1
}

# ══════════════════════════════════════════════════════════════
# Auto Mode (All Phases)
# ══════════════════════════════════════════════════════════════

function Start-Auto {
    Write-Banner
    
    Write-Host "Running all phases automatically..." -ForegroundColor White
    Write-Host ""
    Write-Host "  Phase 1: Initialize (PRD → features)"
    Write-Host "  Phase 2: Validate (ensure coverage)"
    Write-Host "  Phase 3: Implement (build features)"
    Write-Host ""
    Write-Host "Press Ctrl+C at any time to stop" -ForegroundColor Yellow
    Start-Sleep -Seconds 3
    
    # Phase 1: Init (only if feature_list.json doesn't exist)
    if (-not (Test-Path "feature_list.json")) {
        Start-Init
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Initialization failed. Stopping."
            exit 1
        }
    }
    else {
        Write-Info "feature_list.json exists, skipping init phase"
    }
    
    # Phase 2: Validate (only if not already validated)
    $needsValidation = $true
    if (Test-Path "validation-state.json") {
        $valState = Get-Content "validation-state.json" | ConvertFrom-Json
        if ($valState.status -eq "complete") {
            $needsValidation = $false
        }
    }
    
    if ($needsValidation) {
        $valResult = Start-Validate
        if ($valResult -eq 2) {
            Write-Error "Validation blocked. Human review needed."
            exit 2
        }
        elseif ($valResult -ne 0) {
            Write-Warning "Validation incomplete but continuing to implementation..."
        }
    }
    else {
        Write-Info "Validation already complete, skipping validate phase"
    }
    
    # Phase 3: Implement
    Start-Implement
}

# ══════════════════════════════════════════════════════════════
# Status
# ══════════════════════════════════════════════════════════════

function Show-Status {
    Write-Banner
    
    Write-Host "PROJECT STATUS" -ForegroundColor White
    Write-Host ""
    
    # PRD
    if (Test-Path "prd.md") {
        $prdLines = (Get-Content "prd.md").Count
        Write-Success "prd.md exists ($prdLines lines)"
    }
    else {
        Write-Error "prd.md not found"
    }
    
    # Features
    if (Test-Path "feature_list.json") {
        $features = Get-Content "feature_list.json" | ConvertFrom-Json
        $total = $features.features.Count
        $complete = ($features.features | Where-Object { $_.status -eq "complete" }).Count
        $inProgress = ($features.features | Where-Object { $_.status -eq "in_progress" }).Count
        $blocked = ($features.features | Where-Object { $_.status -eq "blocked" }).Count
        $pending = ($features.features | Where-Object { $_.status -eq "pending" }).Count
        
        Write-Success "feature_list.json exists"
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
    else {
        Write-Warning "feature_list.json not found (run .\ralph.ps1 init)"
    }
    
    Write-Host ""
    
    # Validation
    if (Test-Path "validation-state.json") {
        $valState = Get-Content "validation-state.json" | ConvertFrom-Json
        Write-Success "validation-state.json exists"
        Write-Host "    Coverage: $($valState.coverage_percent)%"
        Write-Host "    Status:   $($valState.status)"
    }
    else {
        Write-Warning "validation-state.json not found (run .\ralph.ps1 validate)"
    }
    
    Write-Host ""
    
    # Progress log
    if (Test-Path "copilot-progress.txt") {
        $progressLines = (Get-Content "copilot-progress.txt").Count
        Write-Success "copilot-progress.txt exists ($progressLines lines)"
    }
    else {
        Write-Warning "copilot-progress.txt not found"
    }

    Write-Host ""

    # Next action
    Write-Host "NEXT ACTION" -ForegroundColor White
    if (-not (Test-Path "prd.md")) {
        Write-Host "  → Create prd.md with your requirements"
    }
    elseif (-not (Test-Path "feature_list.json")) {
        Write-Host "  → Run: .\ralph.ps1 init"
    }
    elseif (-not (Test-Path "validation-state.json") -or ((Get-Content "validation-state.json" | ConvertFrom-Json).status -ne "complete")) {
        Write-Host "  → Run: .\ralph.ps1 validate"
    }
    elseif ($blocked -gt 0 -and $pending -eq 0 -and $inProgress -eq 0) {
        Write-Host "  → $blocked feature(s) blocked. Fix in feature_list.json, then: .\ralph.ps1 run"
    }
    elseif ($pending -gt 0 -or $inProgress -gt 0) {
        Write-Host "  → Run: .\ralph.ps1 run"
    }
    else {
        Write-Host "  → All done!"
    }
    
    Write-Host ""
}

# ══════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════

switch ($Command) {
    'author' { Start-Author }
    'init' { Start-Init }
    'validate' { Start-Validate }
    'run' { Start-Implement }
    'implement' { Start-Implement }
    'auto' { Start-Auto }
    'status' { Show-Status }
    'help' { Show-Help }
    default { Show-Help }
}
