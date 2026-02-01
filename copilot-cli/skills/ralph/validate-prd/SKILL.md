# Skill: validate-prd

> Validate a PRD for completeness and quality before running Ralph initialization.

## Purpose

Pre-flight quality check for `prd.md` to catch issues before the Initializer decomposes it into features. Finding problems here saves iteration cycles later.

---

## Validation Categories

### 1. Feature Completeness

- [ ] Every feature area has a clear description
- [ ] Each requirement has 2-3 acceptance criteria minimum
- [ ] Build/test requirements are specified (test command, build command)
- [ ] Error scenarios are defined for each happy path
- [ ] Edge cases are explicitly listed (empty, null, max values, concurrent)

### 2. Test Coverage Requirements

- [ ] Business logic has unit test requirements
- [ ] API endpoints have integration test requirements
- [ ] UI features have E2E test requirements (if applicable)
- [ ] Test command is specified (e.g., `dotnet test`, `npm test`, `pytest`)

### 3. Feature Sizing

- [ ] No single requirement would create more than 4 files
- [ ] Each requirement describes a single concept
- [ ] Requirements can be explained in 2-3 sentences
- [ ] Large features are already broken into sub-requirements

### 4. Dependency Ordering

- [ ] Models/entities appear before services that use them
- [ ] Services appear before controllers/handlers that use them
- [ ] Shared components appear before features that depend on them
- [ ] Infrastructure setup appears before features that need it

### 5. Acceptance Criteria Quality

- [ ] **Specific**: Uses exact names, types, and values (not "should work properly")
- [ ] **Verifiable**: Can be checked by code or test (not "should feel responsive")
- [ ] **Unambiguous**: Only one interpretation possible
- [ ] **Test-Linked**: Each criterion maps to a testable behavior

### 6. RLM Optimization

- [ ] Clear `##` headings for section discovery
- [ ] One requirement per line (for grep extraction)
- [ ] Uses keywords: "must", "shall", "will", "should"
- [ ] Consistent section structure throughout
- [ ] `---` dividers between sections

---

## How to Run This Validation

### Manual (Agent reads and checks)

The agent reads `prd.md` and walks through each checklist category above, reporting:
- **PASS**: Category meets all criteria
- **WARN**: Minor issues that won't block Ralph but should be improved
- **FAIL**: Issues that will cause Ralph to fail or produce poor results

### Output Format

```markdown
## PRD Validation Report

### Summary
- Total checks: 28
- Passed: 24
- Warnings: 3
- Failed: 1

### Issues Found

#### FAIL: Feature Sizing
- "Add user authentication" is too large. Should be split into:
  - "Create User model with email and password hash"
  - "Add password hashing service"
  - "Create login API endpoint"
  - "Create registration API endpoint"
  - "Add JWT token generation"

#### WARN: Missing Error Scenarios
- Section "## Data Import" has no error handling requirements
- What happens when the CSV file is malformed?

#### WARN: Vague Acceptance Criteria
- "The system should be fast" → Specify: "API responses must return within 500ms at p95"

### Recommendations
1. Split "Add user authentication" into 5 smaller requirements
2. Add error handling for data import failures
3. Replace vague performance criteria with specific targets
```

---

## Common Issues

| Issue | Example | Fix |
|-------|---------|-----|
| Too vague | "System should work well" | "Login API must return 200 within 500ms" |
| Too large | "Build the dashboard" | Split into individual components |
| Missing errors | Only happy path described | Add "When X fails, the system must Y" |
| No tests | No mention of testing | Add unit/integration/E2E test requirements |
| Wrong order | Controllers before models | Reorder: models → services → controllers |
| Missing NFRs | No performance targets | Add specific numbers for latency, throughput |
