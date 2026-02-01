#!/bin/bash
#
# Ralph-RLM-Framework v2.0
# Based on Geoffrey Huntley's Ralph Wiggum technique
#
# Three-phase autonomous development:
#   Phase 1: Initialize - PRD → feature_list.json
#   Phase 2: Validate   - Ensure PRD fully covered (loops)
#   Phase 3: Implement  - Build features (loops)
#
# Usage:
#   ./ralph.sh init       # Phase 1: Create features from PRD
#   ./ralph.sh validate   # Phase 2: Validate PRD coverage
#   ./ralph.sh run        # Phase 3: Implement features
#   ./ralph.sh auto       # All phases automatically
#   ./ralph.sh status     # Show current state
#   ./ralph.sh help       # Show this help
#

set -e

# ══════════════════════════════════════════════════════════════
# Script Directory (for finding prompts)
# ══════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMPTS_DIR="$SCRIPT_DIR/prompts"
SKILLS_DIR="$SCRIPT_DIR/.claude/skills"

# ══════════════════════════════════════════════════════════════
# Configuration
# ══════════════════════════════════════════════════════════════

MAX_VALIDATE_ITERATIONS=${MAX_VALIDATE_ITERATIONS:-10}
MAX_IMPLEMENT_ITERATIONS=${MAX_IMPLEMENT_ITERATIONS:-50}
SLEEP_BETWEEN=${SLEEP_BETWEEN:-2}
COVERAGE_THRESHOLD=${COVERAGE_THRESHOLD:-95}
VERBOSE=${VERBOSE:-false}
DEBUG_MODE=${DEBUG_MODE:-false}
ALLOW_ALL_TOOLS=${ALLOW_ALL_TOOLS:-false}
STREAM_OUTPUT=${STREAM_OUTPUT:-false}
LOG_FILE="ralph-debug.log"

# ══════════════════════════════════════════════════════════════
# Flag Parsing
# ══════════════════════════════════════════════════════════════

parse_flags() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -m|--max-iterations|--max-iterations=*)
                if [[ "$1" == *=* ]]; then
                    MAX_IMPLEMENT_ITERATIONS="${1#*=}"
                else
                    MAX_IMPLEMENT_ITERATIONS="$2"
                    shift
                fi
                ;;
            --max-validate-iterations|--max-validate-iterations=*)
                if [[ "$1" == *=* ]]; then
                    MAX_VALIDATE_ITERATIONS="${1#*=}"
                else
                    MAX_VALIDATE_ITERATIONS="$2"
                    shift
                fi
                ;;
            -c|--coverage-threshold|--coverage-threshold=*)
                if [[ "$1" == *=* ]]; then
                    COVERAGE_THRESHOLD="${1#*=}"
                else
                    COVERAGE_THRESHOLD="$2"
                    shift
                fi
                ;;
            -s|--sleep|--sleep=*)
                if [[ "$1" == *=* ]]; then
                    SLEEP_BETWEEN="${1#*=}"
                else
                    SLEEP_BETWEEN="$2"
                    shift
                fi
                ;;
            -v|--verbose)
                VERBOSE=true
                ;;
            --debug)
                DEBUG_MODE=true
                VERBOSE=true
                ;;
            --dangerously-skip-permissions)
                ALLOW_ALL_TOOLS=true
                ;;
            --stream)
                STREAM_OUTPUT=true
                ;;
            -*)
                print_error "Unknown flag: $1"
                echo "Run './ralph.sh help' for usage"
                exit 1
                ;;
            *)
                # Skip unknown positional arguments
                ;;
        esac
        shift
    done
}

# ══════════════════════════════════════════════════════════════
# Colors & Formatting
# ══════════════════════════════════════════════════════════════

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

print_banner() {
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC}  ${BOLD}RALPH-RLM FRAMEWORK v2.0${NC}                                   ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}  Based on Geoffrey Huntley's Ralph Wiggum technique           ${BLUE}║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_phase() {
    echo ""
    echo -e "${CYAN}┌──────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${CYAN}│${NC}  ${BOLD}$1${NC}"
    echo -e "${CYAN}└──────────────────────────────────────────────────────────────┘${NC}"
    echo ""
}

print_success() { echo -e "${GREEN}[✓]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[!]${NC} $1"; }
print_error()   { echo -e "${RED}[✗]${NC} $1"; }
print_info()    { echo -e "${BLUE}[i]${NC} $1"; }

# ══════════════════════════════════════════════════════════════
# Verbose/Debug Functions
# ══════════════════════════════════════════════════════════════

log_debug() {
    if [[ "$VERBOSE" == "true" ]]; then
        echo -e "${CYAN}[DEBUG]${NC} $1"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
    fi
}

# Build Claude CLI flags based on tool permissions and verbosity
get_claude_flags() {
    local flags=""

    if [[ "$ALLOW_ALL_TOOLS" == "true" ]]; then
        # Full bypass — all tools allowed without permission prompts
        flags="--dangerously-skip-permissions"
    else
        # Explicit allowlist — safe default for autonomous operation
        flags="$flags --allowedTools"
        # File operations
        flags="$flags \"Read\" \"Write\" \"Edit\" \"Glob\" \"Grep\" \"TodoWrite\""
        # Git
        flags="$flags \"Bash(git:*)\""
        # Build tools
        flags="$flags \"Bash(dotnet:*)\" \"Bash(npm:*)\" \"Bash(node:*)\" \"Bash(python:*)\" \"Bash(pytest:*)\""
        # Shell utilities needed by implementer
        flags="$flags \"Bash(jq:*)\" \"Bash(head:*)\" \"Bash(cat:*)\" \"Bash(grep:*)\" \"Bash(find:*)\""
        flags="$flags \"Bash(ls:*)\" \"Bash(mkdir:*)\" \"Bash(cp:*)\" \"Bash(mv:*)\" \"Bash(wc:*)\" \"Bash(chmod:*)\""
        # Ralph companion scripts (./ prefix)
        flags="$flags \"Bash(./:*)\""
    fi

    # Verbosity flags
    if [[ "$DEBUG_MODE" == "true" ]]; then
        flags="$flags --debug"
    elif [[ "$VERBOSE" == "true" ]]; then
        flags="$flags --verbose"
    fi

    # Stream JSON output (requires --verbose)
    if [[ "$STREAM_OUTPUT" == "true" ]]; then
        if [[ "$flags" != *"--verbose"* ]]; then
            flags="$flags --verbose"
        fi
        flags="$flags --output-format stream-json"
    fi

    echo "$flags"
}

show_context_summary() {
    if [[ "$VERBOSE" != "true" ]]; then
        return
    fi
    
    echo ""
    echo -e "${CYAN}┌─────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${CYAN}│${NC}  ${BOLD}CONTEXT SUMMARY (RLM)${NC}                                          ${CYAN}│${NC}"
    echo -e "${CYAN}└─────────────────────────────────────────────────────────────────┘${NC}"
    
    # PRD size
    if [[ -f "prd.md" ]]; then
        local prd_lines=$(wc -l < prd.md)
        local prd_size=$(du -h prd.md | cut -f1)
        echo -e "  ${BOLD}prd.md:${NC} $prd_lines lines ($prd_size)"
        if [[ $prd_lines -gt 500 ]]; then
            echo -e "    ${YELLOW}→ Large PRD: AI will use grep/sed to read sections${NC}"
        else
            echo -e "    ${GREEN}→ Small PRD: AI can read directly${NC}"
        fi
    fi
    
    # Feature list size
    if [[ -f "feature_list.json" ]]; then
        local feature_count=$(jq '.features | length' feature_list.json 2>/dev/null || echo "?")
        local feature_size=$(du -h feature_list.json | cut -f1)
        echo -e "  ${BOLD}feature_list.json:${NC} $feature_count features ($feature_size)"
        if [[ "$feature_count" -gt 50 ]] 2>/dev/null; then
            echo -e "    ${YELLOW}→ Many features: AI will use jq to query${NC}"
        else
            echo -e "    ${GREEN}→ Few features: AI can read directly${NC}"
        fi
        
        # Show status breakdown
        local complete=$(jq '[.features[] | select(.status == "complete")] | length' feature_list.json 2>/dev/null || echo "0")
        local pending=$(jq '[.features[] | select(.status == "pending")] | length' feature_list.json 2>/dev/null || echo "0")
        local in_progress=$(jq '[.features[] | select(.status == "in_progress")] | length' feature_list.json 2>/dev/null || echo "0")
        local blocked=$(jq '[.features[] | select(.status == "blocked")] | length' feature_list.json 2>/dev/null || echo "0")
        echo -e "    Status: ${GREEN}$complete done${NC} | ${YELLOW}$in_progress active${NC} | ${BLUE}$pending pending${NC} | ${RED}$blocked blocked${NC}"
    fi
    
    # Codebase size
    local code_files=$(find . -type f \( -name "*.py" -o -name "*.js" -o -name "*.ts" -o -name "*.cs" -o -name "*.java" -o -name "*.go" \) \
        ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/venv/*" 2>/dev/null | wc -l)
    echo -e "  ${BOLD}Codebase:${NC} $code_files code files"
    if [[ $code_files -gt 50 ]]; then
        echo -e "    ${YELLOW}→ Large codebase: AI will use grep/find to search${NC}"
    else
        echo -e "    ${GREEN}→ Small codebase: AI can explore directly${NC}"
    fi
    
    # Progress file
    if [[ -f "claude-progress.txt" ]]; then
        local progress_lines=$(wc -l < claude-progress.txt)
        echo -e "  ${BOLD}claude-progress.txt:${NC} $progress_lines lines"
        if [[ $progress_lines -gt 200 ]]; then
            echo -e "    ${YELLOW}→ Long history: AI will use tail -50${NC}"
        fi
    fi
    
    echo ""
    log_debug "Context summary displayed"
}

# ══════════════════════════════════════════════════════════════
# Help
# ══════════════════════════════════════════════════════════════

show_help() {
    print_banner
    echo -e "${BOLD}USAGE${NC}"
    echo "  ./ralph.sh <command> [options]"
    echo ""
    echo -e "${BOLD}COMMANDS${NC}"
    echo "  author      Interactive PRD creation assistant"
    echo "  init        Phase 1: Analyze PRD and create feature_list.json"
    echo "  validate    Phase 2: Validate all PRD requirements are covered (loops)"
    echo "  run         Phase 3: Implement features one by one (loops)"
    echo "  auto        Run all phases automatically"
    echo "  status      Show current project state"
    echo "  help        Show this help message"
    echo ""
    echo -e "${BOLD}FLAGS${NC}"
    echo "  -m, --max-iterations N          Max implementation iterations (default: 50)"
    echo "  --max-validate-iterations N     Max validation iterations (default: 10)"
    echo "  -c, --coverage-threshold N      Required PRD coverage % (default: 95)"
    echo "  -s, --sleep N                   Seconds between iterations (default: 2)"
    echo "  -v, --verbose                   Show context summary and RLM debug info"
    echo "  --debug                         Enable Claude Code debug-level tracing (implies --verbose)"
    echo "  --dangerously-skip-permissions  Full tool access with deny rules (less safe, faster)"
    echo "  --stream                        Stream Claude Code output as JSON (for CI/automation)"
    echo ""
    echo -e "${BOLD}WORKFLOW${NC}"
    echo ""
    echo "  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐"
    echo "  │   prd.md    │ ──▶ │  INIT       │ ──▶ │  VALIDATE   │"
    echo "  │ (you write) │     │  (once)     │     │  (loops)    │"
    echo "  └─────────────┘     └─────────────┘     └──────┬──────┘"
    echo "                                                 │"
    echo "                                                 ▼"
    echo "                                          ┌─────────────┐"
    echo "                                          │  IMPLEMENT  │"
    echo "                                          │  (loops)    │"
    echo "                                          └─────────────┘"
    echo ""
    echo -e "${BOLD}QUICK START${NC}"
    echo "  1. Run: ./ralph.sh author    (get help writing your PRD)"
    echo "  2. Write your requirements in prd.md"
    echo "  3. Run: ./ralph.sh auto"
    echo "  4. Go make coffee"
    echo ""
    echo -e "${BOLD}ENVIRONMENT VARIABLES${NC}"
    echo "  MAX_VALIDATE_ITERATIONS   Max validation loops (default: 10)"
    echo "  MAX_IMPLEMENT_ITERATIONS  Max implementation loops (default: 50)"
    echo "  COVERAGE_THRESHOLD        Required PRD coverage % (default: 95)"
    echo "  SLEEP_BETWEEN             Seconds between iterations (default: 2)"
    echo ""
    echo -e "${BOLD}EXAMPLES${NC}"
    echo "  ./ralph.sh author                        # Get help writing your PRD"
    echo "  ./ralph.sh auto                          # Run everything"
    echo "  ./ralph.sh auto -v                       # Run with context summary"
    echo "  ./ralph.sh init                          # Just create features"
    echo "  ./ralph.sh validate                      # Just validate coverage"
    echo "  ./ralph.sh run                           # Just implement"
    echo "  ./ralph.sh run -m 10                     # Run with max 10 iterations"
    echo "  ./ralph.sh run --max-iterations=100      # Run with max 100 iterations"
    echo "  ./ralph.sh validate -c 90                # Validate with 90% coverage threshold"
    echo "  ./ralph.sh run -v                        # Run with verbose/debug output"
    echo "  ./ralph.sh run --dangerously-skip-permissions               # Full tool access (less safe)"
    echo "  ./ralph.sh auto --dangerously-skip-permissions --debug      # Full access + debug tracing"
    echo ""
    echo -e "${BOLD}FILES${NC}"
    echo "  prd.md                Your requirements (input)"
    echo "  feature_list.json     Generated features with status"
    echo "  validation-state.json Validation coverage tracking"
    echo "  claude-progress.txt   Detailed iteration log"
    echo ""
    echo -e "${BOLD}FRAMEWORK DIRECTORIES${NC}"
    echo "  .claude/skills/       Auto-discovered skill definitions and scripts"
    echo "  .claude/skills/ralph/ Core Ralph loop skills"
    echo "  .claude/rules/        Auto-loaded coding rules (by file pattern)"
    echo ""
    echo -e "${BOLD}LEARN MORE${NC}"
    echo "  Original technique: https://ghuntley.com/ralph/"
    echo ""
}

# ══════════════════════════════════════════════════════════════
# Pre-flight Checks
# ══════════════════════════════════════════════════════════════

preflight_check() {
    local phase=$1
    
    echo ""
    echo -e "${BLUE}Pre-flight checks...${NC}"
    
    # Check: Git repository
    if [ ! -d ".git" ]; then
        print_error "Not a git repository! Ralph requires git for safety."
        echo "       Run: git init"
        exit 1
    fi
    print_success "Git repository detected"
    
    # Check: Claude Code CLI
    if ! command -v claude &> /dev/null; then
        print_error "Claude Code CLI not found!"
        echo "       Install: npm install -g @anthropic-ai/claude-code"
        exit 1
    fi
    print_success "Claude Code CLI found"

    # Check: jq (required for feature_list.json queries)
    if ! command -v jq &> /dev/null; then
        print_error "jq not found! Required for parsing feature_list.json."
        echo "       Install:"
        echo "         macOS:   brew install jq"
        echo "         Ubuntu:  sudo apt install jq"
        echo "         Windows: winget install jqlang.jq"
        exit 1
    fi
    print_success "jq found"
    
    # Phase-specific checks
    case $phase in
        init)
            if [ ! -f "prd.md" ]; then
                print_error "prd.md not found!"
                echo "       Create prd.md with your project requirements first."
                echo "       See templates/prd.md for an example."
                exit 1
            fi
            print_success "prd.md found"
            
            if [ ! -f "$PROMPTS_DIR/initializer.md" ]; then
                print_error "$PROMPTS_DIR/initializer.md not found!"
                exit 1
            fi
            print_success "$PROMPTS_DIR/initializer.md found"
            ;;
            
        validate)
            if [ ! -f "prd.md" ]; then
                print_error "prd.md not found!"
                exit 1
            fi
            print_success "prd.md found"
            
            if [ ! -f "feature_list.json" ]; then
                print_error "feature_list.json not found!"
                echo "       Run './ralph.sh init' first."
                exit 1
            fi
            print_success "feature_list.json found"
            
            if [ ! -f "$PROMPTS_DIR/validator.md" ]; then
                print_error "$PROMPTS_DIR/validator.md not found!"
                exit 1
            fi
            print_success "$PROMPTS_DIR/validator.md found"
            ;;
            
        run)
            if [ ! -f "feature_list.json" ]; then
                print_error "feature_list.json not found!"
                echo "       Run './ralph.sh init' first."
                exit 1
            fi
            print_success "feature_list.json found"
            
            if [ ! -f "$PROMPTS_DIR/implementer.md" ]; then
                print_error "$PROMPTS_DIR/implementer.md not found!"
                exit 1
            fi
            print_success "$PROMPTS_DIR/implementer.md found"
            
            if [ ! -f "claude-progress.txt" ]; then
                print_warning "claude-progress.txt not found, creating..."
                touch claude-progress.txt
            fi
            print_success "claude-progress.txt found"
            ;;
    esac
    
    echo ""
}

# ══════════════════════════════════════════════════════════════
# PRD Author (Interactive)
# ══════════════════════════════════════════════════════════════

run_author() {
    print_phase "PRD AUTHOR"
    echo "Interactive PRD creation assistant..."
    echo ""

    # Check: Git repository
    if [ ! -d ".git" ]; then
        print_error "Not a git repository! Initialize with: git init"
        exit 1
    fi

    # Check: Claude Code CLI
    if ! command -v claude &> /dev/null; then
        print_error "Claude Code CLI not found!"
        echo "       Install: npm install -g @anthropic-ai/claude-code"
        exit 1
    fi

    # Check: PRD Author skill
    local SKILL_FILE="$SKILLS_DIR/ralph/prd-author/SKILL.md"
    if [ ! -f "$SKILL_FILE" ]; then
        print_error "PRD Author skill not found at: $SKILL_FILE"
        exit 1
    fi
    print_success "PRD Author skill found"

    # Check: PRD template
    local TEMPLATE_FILE="$SCRIPT_DIR/templates/prd.md"
    if [ -f "$TEMPLATE_FILE" ]; then
        print_success "PRD template found"
    fi

    echo ""
    print_info "Running PRD Author assistant..."
    print_info "This will guide you through creating a high-quality prd.md"
    echo ""

    # Read skill content, stripping YAML frontmatter if present
    # (frontmatter starts/ends with --- which claude CLI misinterprets as a flag)
    local SKILL_CONTENT
    if head -1 "$SKILL_FILE" | grep -q '^---$'; then
        SKILL_CONTENT=$(awk 'BEGIN{c=0} /^---$/{c++; next} c>=2{print}' "$SKILL_FILE")
    else
        SKILL_CONTENT=$(cat "$SKILL_FILE")
    fi

    # Use interactive mode (no -p flag) so the user can answer questions
    claude $(get_claude_flags) "$SKILL_CONTENT

You are helping the user create a prd.md for Ralph-RLM-Framework.

If a prd.md template exists at templates/prd.md, use it as the output structure.
Guide the user through each phase described above.
Save the final result as prd.md in the current directory.

Start by asking the user about their project (Phase 1: Project Understanding)."

    if [ -f "prd.md" ]; then
        print_success "prd.md created successfully!"
        echo ""
        echo "Next steps:"
        echo "  1. Review prd.md"
        echo "  2. Run: ./ralph.sh auto"
    else
        print_warning "prd.md was not created. You can create it manually using templates/prd.md"
    fi
}

# ══════════════════════════════════════════════════════════════
# Phase 1: Initialize
# ══════════════════════════════════════════════════════════════

run_init() {
    print_phase "PHASE 1: INITIALIZE"
    echo "Analyzing PRD and creating feature_list.json..."
    echo ""
    
    preflight_check "init"
    show_context_summary
    
    # Create safety checkpoint
    git stash push -m "ralph-pre-init-$(date +%s)" --include-untracked 2>/dev/null || true
    
    log_debug "Starting initializer agent"
    
    # Run initializer
    print_info "Running initializer agent..."
    echo ""
    
    claude $(get_claude_flags) -p "$(cat "$PROMPTS_DIR/initializer.md")

Read the project requirements from: prd.md"
    
    if [ -f "feature_list.json" ]; then
        FEATURE_COUNT=$(jq '.features | length' feature_list.json 2>/dev/null || echo "0")
        echo ""
        print_success "Initialization complete!"
        print_info "Created $FEATURE_COUNT features in feature_list.json"
        log_debug "Init complete: $FEATURE_COUNT features created"
        echo ""
        echo "Next step: ./ralph.sh validate"
    else
        print_error "Initialization failed - feature_list.json not created"
        log_debug "Init FAILED: feature_list.json not created"
        exit 1
    fi
}

# ══════════════════════════════════════════════════════════════
# Phase 2: Validate
# ══════════════════════════════════════════════════════════════

run_validate() {
    print_phase "PHASE 2: VALIDATE PRD COVERAGE"
    echo "Ensuring all requirements are covered by features..."
    echo ""
    
    preflight_check "validate"
    show_context_summary
    
    ITERATION=0
    
    # Initialize validation state if not exists
    if [ ! -f "validation-state.json" ]; then
        echo '{
  "coverage_percent": 0,
  "iteration": 0,
  "status": "in_progress",
  "gaps": [],
  "last_updated": "'$(date -Iseconds)'"
}' > validation-state.json
    fi
    
    while [ $ITERATION -lt $MAX_VALIDATE_ITERATIONS ]; do
        echo ""
        echo -e "${CYAN}━━━ Validation Iteration $((ITERATION + 1)) of $MAX_VALIDATE_ITERATIONS ━━━${NC}"
        log_debug "Validation iteration $((ITERATION + 1)) starting"
        echo ""
        
        # Run validator (files are read by Claude directly to avoid arg length limits)
        claude $(get_claude_flags) -p "$(cat "$PROMPTS_DIR/validator.md")

Read these files from the current directory:
- prd.md (the original PRD)
- feature_list.json (current features)
- validation-state.json (validation state)"
        
        # Check for completion
        if [ -f "validation-state.json" ]; then
            COVERAGE=$(jq -r '.coverage_percent // 0' validation-state.json)
            STATUS=$(jq -r '.status // "in_progress"' validation-state.json)
            
            log_debug "Validation result: coverage=$COVERAGE%, status=$STATUS"
            
            if [ "$STATUS" = "complete" ] || [ "$COVERAGE" -ge "$COVERAGE_THRESHOLD" ]; then
                echo ""
                print_success "Validation complete! Coverage: ${COVERAGE}%"
                echo ""
                echo "Next step: ./ralph.sh run"
                return 0
            fi
            
            if [ "$STATUS" = "blocked" ]; then
                echo ""
                print_warning "Validation blocked - human review needed"
                print_info "Check validation-state.json for details"
                return 2
            fi
        fi
        
        ITERATION=$((ITERATION + 1))
        
        if [ $ITERATION -lt $MAX_VALIDATE_ITERATIONS ]; then
            print_info "Coverage not met. Retrying in ${SLEEP_BETWEEN}s..."
            sleep $SLEEP_BETWEEN
        fi
    done
    
    echo ""
    print_warning "Max validation iterations reached ($MAX_VALIDATE_ITERATIONS)"
    print_info "Check validation-state.json for current coverage"
    return 1
}

# ══════════════════════════════════════════════════════════════
# Phase 3: Implement (Ralph Loop)
# ══════════════════════════════════════════════════════════════

run_implement() {
    print_phase "PHASE 3: IMPLEMENT FEATURES (RALPH LOOP)"
    echo "Implementing features one by one until complete..."
    echo ""
    
    preflight_check "run"
    show_context_summary
    
    # Safety checkpoint
    git stash push -m "ralph-pre-implement-$(date +%s)" --include-untracked 2>/dev/null || true
    
    ITERATION=0

    # Pre-loop check: are there any features to work on?
    REMAINING=$(jq '[.features[] | select(.status == "pending" or .status == "in_progress")] | length' feature_list.json 2>/dev/null || echo "0")
    if [ "$REMAINING" -eq 0 ]; then
        BLOCKED_COUNT=$(jq '[.features[] | select(.status == "blocked")] | length' feature_list.json 2>/dev/null || echo "0")
        if [ "$BLOCKED_COUNT" -gt 0 ]; then
            print_warning "No pending features, but $BLOCKED_COUNT feature(s) are blocked"
            print_info "Fix blocked features in feature_list.json and re-run"
            return 2
        else
            print_success "All features are already complete! Nothing to do."
            return 0
        fi
    fi
    print_info "$REMAINING feature(s) remaining to implement"

    while [ $ITERATION -lt $MAX_IMPLEMENT_ITERATIONS ]; do
        echo ""
        echo -e "${CYAN}━━━ Implementation Iteration $((ITERATION + 1)) of $MAX_IMPLEMENT_ITERATIONS ━━━${NC}"
        echo -e "${CYAN}    $(date '+%Y-%m-%d %H:%M:%S')${NC}"
        log_debug "Implementation iteration $((ITERATION + 1)) starting"
        echo ""

        # Windows NUL file cleanup: Claude Code on Windows can create a literal 'nul' file
        # (Windows reserved device name) which breaks git operations. Remove it if present.
        if [ -f "nul" ]; then
            rm -f "nul" 2>/dev/null || true
            log_debug "Removed stale 'nul' file (Windows Claude Code bug)"
        fi

        # Run implementer
        claude $(get_claude_flags) -p "$(cat "$PROMPTS_DIR/implementer.md")"

        EXIT_CODE=$?

        if [ $EXIT_CODE -ne 0 ]; then
            print_warning "Claude exited with code $EXIT_CODE"
            log_debug "Claude exited with code $EXIT_CODE"
        fi

        # Data-driven completion check: query feature_list.json directly
        REMAINING=$(jq '[.features[] | select(.status == "pending" or .status == "in_progress")] | length' feature_list.json 2>/dev/null || echo "-1")
        BLOCKED_COUNT=$(jq '[.features[] | select(.status == "blocked")] | length' feature_list.json 2>/dev/null || echo "0")
        TOTAL=$(jq '.features | length' feature_list.json 2>/dev/null || echo "0")
        COMPLETE=$(jq '[.features[] | select(.status == "complete")] | length' feature_list.json 2>/dev/null || echo "0")

        log_debug "Status: $COMPLETE/$TOTAL complete, $REMAINING remaining, $BLOCKED_COUNT blocked"

        # Sanity check: if total is 0, feature_list.json is corrupted
        if [ "$TOTAL" -eq 0 ]; then
            print_warning "feature_list.json appears corrupted (0 features found). Stopping loop."
            print_info "Check feature_list.json for valid JSON structure."
            return 1
        fi

        # All features complete (none pending or in_progress, none blocked)
        if [ "$REMAINING" -eq 0 ] && [ "$BLOCKED_COUNT" -eq 0 ]; then
            echo ""
            echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
            echo -e "${GREEN}║${NC}  ${BOLD}ALL FEATURES COMPLETE!${NC}  ($COMPLETE/$TOTAL)                       ${GREEN}║${NC}"
            echo -e "${GREEN}║${NC}     Total iterations: $((ITERATION + 1))                                  ${GREEN}║${NC}"
            echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
            echo ""
            log_debug "ALL FEATURES COMPLETE after $((ITERATION + 1)) iterations"
            return 0
        fi

        # No work left but some features are blocked
        if [ "$REMAINING" -eq 0 ] && [ "$BLOCKED_COUNT" -gt 0 ]; then
            echo ""
            echo -e "${YELLOW}╔══════════════════════════════════════════════════════════════╗${NC}"
            echo -e "${YELLOW}║${NC}  ${BOLD}BLOCKED - Human intervention needed${NC}                         ${YELLOW}║${NC}"
            echo -e "${YELLOW}║${NC}     $COMPLETE/$TOTAL complete, $BLOCKED_COUNT blocked                              ${YELLOW}║${NC}"
            echo -e "${YELLOW}║${NC}     Check feature_list.json for blocked features                ${YELLOW}║${NC}"
            echo -e "${YELLOW}╚══════════════════════════════════════════════════════════════╝${NC}"
            echo ""
            log_debug "BLOCKED at iteration $((ITERATION + 1)): $BLOCKED_COUNT features blocked"
            return 2
        fi

        ITERATION=$((ITERATION + 1))

        if [ $ITERATION -lt $MAX_IMPLEMENT_ITERATIONS ]; then
            print_info "Progress: $COMPLETE/$TOTAL complete, $REMAINING remaining. Next in ${SLEEP_BETWEEN}s... (Ctrl+C to stop)"
            sleep $SLEEP_BETWEEN
        fi
    done

    echo ""
    print_warning "Max iterations reached ($MAX_IMPLEMENT_ITERATIONS)"
    print_info "Progress: $COMPLETE/$TOTAL complete, $REMAINING remaining"
    return 1
}

# ══════════════════════════════════════════════════════════════
# Auto Mode (All Phases)
# ══════════════════════════════════════════════════════════════

run_auto() {
    print_banner
    
    echo -e "${BOLD}Running all phases automatically...${NC}"
    echo ""
    echo "  Phase 1: Initialize (PRD → features)"
    echo "  Phase 2: Validate (ensure coverage)"
    echo "  Phase 3: Implement (build features)"
    echo ""
    echo -e "${YELLOW}Press Ctrl+C at any time to stop${NC}"
    sleep 3
    
    # Phase 1: Init (only if feature_list.json doesn't exist)
    if [ ! -f "feature_list.json" ]; then
        run_init
        if [ $? -ne 0 ]; then
            print_error "Initialization failed. Stopping."
            exit 1
        fi
    else
        print_info "feature_list.json exists, skipping init phase"
    fi
    
    # Phase 2: Validate (only if not already validated)
    if [ ! -f "validation-state.json" ] || [ "$(jq -r '.status' validation-state.json 2>/dev/null)" != "complete" ]; then
        run_validate
        VALIDATE_RESULT=$?
        if [ $VALIDATE_RESULT -eq 2 ]; then
            print_error "Validation blocked. Human review needed."
            exit 2
        elif [ $VALIDATE_RESULT -ne 0 ]; then
            print_warning "Validation incomplete but continuing to implementation..."
        fi
    else
        print_info "Validation already complete, skipping validate phase"
    fi
    
    # Phase 3: Implement
    run_implement
}

# ══════════════════════════════════════════════════════════════
# Status
# ══════════════════════════════════════════════════════════════

show_status() {
    print_banner
    
    echo -e "${BOLD}PROJECT STATUS${NC}"
    echo ""
    
    # PRD
    if [ -f "prd.md" ]; then
        PRD_LINES=$(wc -l < prd.md)
        print_success "prd.md exists ($PRD_LINES lines)"
    else
        print_error "prd.md not found"
    fi
    
    # Features
    if [ -f "feature_list.json" ]; then
        TOTAL=$(jq '.features | length' feature_list.json 2>/dev/null || echo "0")
        COMPLETE=$(jq '[.features[] | select(.status == "complete")] | length' feature_list.json 2>/dev/null || echo "0")
        IN_PROGRESS=$(jq '[.features[] | select(.status == "in_progress")] | length' feature_list.json 2>/dev/null || echo "0")
        BLOCKED=$(jq '[.features[] | select(.status == "blocked")] | length' feature_list.json 2>/dev/null || echo "0")
        PENDING=$(jq '[.features[] | select(.status == "pending")] | length' feature_list.json 2>/dev/null || echo "0")
        
        print_success "feature_list.json exists"
        echo ""
        echo "  Features:"
        echo "    Total:       $TOTAL"
        echo -e "    Complete:    ${GREEN}$COMPLETE${NC}"
        echo -e "    In Progress: ${YELLOW}$IN_PROGRESS${NC}"
        echo -e "    Pending:     ${BLUE}$PENDING${NC}"
        echo -e "    Blocked:     ${RED}$BLOCKED${NC}"
        
        if [ "$TOTAL" -gt 0 ]; then
            PERCENT=$((COMPLETE * 100 / TOTAL))
            echo ""
            echo "  Progress: $PERCENT%"
        fi
    else
        print_warning "feature_list.json not found (run ./ralph.sh init)"
    fi
    
    echo ""
    
    # Validation
    if [ -f "validation-state.json" ]; then
        COVERAGE=$(jq -r '.coverage_percent // 0' validation-state.json)
        VAL_STATUS=$(jq -r '.status // "unknown"' validation-state.json)
        print_success "validation-state.json exists"
        echo "    Coverage: ${COVERAGE}%"
        echo "    Status:   $VAL_STATUS"
    else
        print_warning "validation-state.json not found (run ./ralph.sh validate)"
    fi
    
    echo ""
    
    # Progress log
    if [ -f "claude-progress.txt" ]; then
        PROGRESS_LINES=$(wc -l < claude-progress.txt)
        print_success "claude-progress.txt exists ($PROGRESS_LINES lines)"
    else
        print_warning "claude-progress.txt not found"
    fi
    
    echo ""
    
    # Next action
    echo -e "${BOLD}NEXT ACTION${NC}"
    if [ ! -f "prd.md" ]; then
        echo "  → Create prd.md with your requirements"
    elif [ ! -f "feature_list.json" ]; then
        echo "  → Run: ./ralph.sh init"
    elif [ ! -f "validation-state.json" ] || [ "$(jq -r '.status' validation-state.json 2>/dev/null)" != "complete" ]; then
        echo "  → Run: ./ralph.sh validate"
    elif [ "$BLOCKED" -gt 0 ] 2>/dev/null && [ "$PENDING" -eq 0 ] 2>/dev/null && [ "$IN_PROGRESS" -eq 0 ] 2>/dev/null; then
        echo "  → $BLOCKED feature(s) blocked. Fix in feature_list.json, then: ./ralph.sh run"
    elif [ "$PENDING" -gt 0 ] 2>/dev/null || [ "$IN_PROGRESS" -gt 0 ] 2>/dev/null; then
        echo "  → Run: ./ralph.sh run"
    else
        echo "  → All done!"
    fi
    
    echo ""
}

# ══════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════

COMMAND=${1:-help}
shift 2>/dev/null || true
parse_flags "$@"

case $COMMAND in
    author)
        run_author
        ;;
    init)
        run_init
        ;;
    validate)
        run_validate
        ;;
    run|implement)
        run_implement
        ;;
    auto)
        run_auto
        ;;
    status)
        show_status
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        print_error "Unknown command: $COMMAND"
        echo "Run './ralph.sh help' for usage"
        exit 1
        ;;
esac
