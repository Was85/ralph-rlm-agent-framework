# Product Requirements Document (PRD)

<!--
═══════════════════════════════════════════════════════════════════════════════
PRD WRITING GUIDE FOR RALPH-RLM-FRAMEWORK

This template is optimized for RLM (Recursive Language Model) reading.
The AI reads your PRD using grep/sed to find sections, so:

1. USE CLEAR HEADINGS - Start with ## (e.g., ## Functional Requirements)
2. USE KEYWORDS - Include "must", "shall", "will", "should" for requirements
3. ONE REQUIREMENT PER LINE - Makes grep extraction work better
4. KEEP SECTIONS SEPARATE - Clear --- dividers between sections
5. USE CONSISTENT STRUCTURE - Same format in each section

The AI will run these commands to read your PRD:
  grep -n "^#" prd.md                    # Find all headings
  grep -n "must|shall|will" prd.md       # Find all requirements
  grep -A 30 "## Functional" prd.md      # Read specific section

So structure matters!
═══════════════════════════════════════════════════════════════════════════════
-->

---

## Project Overview

**Project Name:** [Your Project Name]

**Description:** [One paragraph describing what this project does]

**Tech Stack:** [e.g., .NET 8, Node.js, Python, React, etc.]

**Target:** [Who is this for? What problem does it solve?]

---

## Goals

1. [Goal 1]
2. [Goal 2]
3. [Goal 3]

---

## Functional Requirements

<!-- 
WRITE REQUIREMENTS LIKE THIS (one per line, with keywords):
- The system must [do something specific]
- Users shall be able to [action]
- The API will return [specific response]

BAD (vague, no keyword):
- Handle authentication

GOOD (specific, has "must"):
- The system must authenticate users via JWT tokens
- The system must reject expired tokens with 401 status
- The system must refresh tokens before expiry
-->

### User Authentication

- The system must allow users to register with email and password
- The system must validate email format before registration
- The system must hash passwords using bcrypt
- The system must issue JWT tokens on successful login
- The system must reject invalid credentials with 401 status
- The system must support password reset via email

### [Feature Area 2]

- The system must [requirement]
- The system must [requirement]
- Users shall be able to [requirement]

### [Feature Area 3]

- The system must [requirement]
- The system will [requirement]

---

## Non-Functional Requirements

<!--
NFRs are often MISSED! Be explicit about:
- Performance (response times, throughput)
- Security (encryption, authentication)
- Scalability (users, data volume)
- Reliability (uptime, error handling)
-->

### Performance

- The system must respond within 200ms for API calls
- The system must handle 1000 concurrent users
- Database queries must complete within 100ms

### Security

- All API endpoints must require authentication (except login/register)
- All data must be encrypted in transit (HTTPS/TLS)
- Passwords must be hashed with bcrypt (cost factor 12)
- JWT tokens must expire after 24 hours
- The system must rate-limit login attempts to 5 per minute

### Scalability

- The system must support horizontal scaling
- Database must handle 1 million records

### Logging

- The system must log all API requests
- The system must log all errors with stack traces
- Logs must include correlation IDs for tracing

---

## Error Handling

<!--
IMPORTANT: Define what happens when things FAIL
Use "When [X] fails/errors, the system must [Y]"
-->

- When database connection fails, the system must return 503 status
- When external API times out, the system must retry 3 times
- When validation fails, the system must return 400 with error details
- When authentication fails, the system must return 401 status
- When rate limit exceeded, the system must return 429 status

---

## Integrations

<!--
List external systems with specific details:
- API endpoints
- Authentication method
- Data format
-->

### [External System 1]

- **Endpoint:** https://api.example.com/v1
- **Auth:** API Key in header
- **The system must** call this API to [purpose]
- **The system must** handle timeout after 30 seconds

### [External System 2]

- **The system must** integrate with [system] for [purpose]

---

## Data Requirements

<!--
Define data entities with constraints.
Use "must" for validation rules.
-->

### User Entity

- email: string, required, must be unique, must be valid email format
- password: string, required, must be minimum 8 characters
- created_at: datetime, required
- updated_at: datetime, required

### [Entity 2]

- [field]: [type], [constraints]

---

## User Scenarios

<!--
Walk through user journeys.
Helps catch edge cases.
-->

### Scenario: User Registration

1. User submits email and password
2. System validates email format
3. System checks email is not already registered
4. System hashes password and creates user
5. System returns success with JWT token

### Scenario: User Login

1. User submits email and password
2. System validates credentials
3. If valid, system returns JWT token
4. If invalid, system returns 401 error

### Scenario: [Name]

1. [Step]
2. [Step]

---

## Out of Scope

<!--
Explicitly state what you're NOT building.
Prevents AI from adding unwanted features.
-->

- Social login (Google, Facebook) - NOT in this version
- Two-factor authentication - NOT in this version
- [Other exclusions]

---

## Acceptance Criteria

<!--
How do we know we're done?
-->

- [ ] All functional requirements implemented
- [ ] All tests passing
- [ ] API response times under 200ms
- [ ] Security requirements met
- [ ] Documentation complete

---

<!--
═══════════════════════════════════════════════════════════════════════════════
CHECKLIST BEFORE RUNNING RALPH:

[ ] Every requirement has "must", "shall", "will", or "should"
[ ] Each requirement is on its own line (not combined)
[ ] Sections have clear ## headings
[ ] Error scenarios are defined
[ ] NFRs (performance, security) are specified
[ ] External integrations are documented
[ ] Out of scope items are listed

RLM KEYWORDS THE AI SEARCHES FOR:
- "must" / "shall" / "will" / "should" → Requirements
- "error" / "fail" / "invalid" → Error handling
- "performance" / "security" / "scale" → NFRs
- "## " → Section headings

The clearer your PRD, the better the features!
═══════════════════════════════════════════════════════════════════════════════
-->
