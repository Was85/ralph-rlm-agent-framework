---
name: prd-author
description: Interactive assistant that guides users through creating high-quality PRDs for Ralph-RLM Framework. Asks structured questions about project type, requirements, testing needs, and dependency ordering.
user-invocable: true
---

# Skill: prd-author

> Guide users through creating high-quality PRDs for the Ralph-RLM Framework.

## Purpose

Interactively help users write comprehensive Product Requirements Documents (PRDs) optimized for Ralph's three-phase autonomous loop. A well-written PRD prevents failures during implementation.

**Philosophy**: "Ask 5 questions upfront rather than have Ralph fail 5 iterations."

---

## Workflow

### Questioning Strategy

Ask questions in focused rounds of 3-5 questions. Present numbered options with lettered choices for rapid iteration:

```
1. What type of project?
   A) Greenfield (new project)
   B) Brownfield (adding to existing code)
   C) Bug fix / patch
```

Users respond with shorthand like "1A, 2C" for speed. Conduct 2-4 rounds of adaptive follow-up before generating the PRD. Don't over-specify or under-specify -- adapt based on answers.

### Phase 1: Project Understanding (MANDATORY)

Before writing anything, ask the user:

**For Greenfield Projects:**
- What is the project name and description?
- What is the tech stack? (e.g., .NET 10, Node.js, Python, React)
- Who are the target users?
- What are the core capabilities?
- Any design documents or references?
- What is the deployment target?

**For Brownfield Projects (adding to existing code):**
- What is the existing project structure?
- What patterns/conventions does the codebase follow?
- What is being added, changed, or fixed?
- Which areas of the codebase are affected?
- What existing tests exist?

**For Bug Fixes:**
- What is the expected behavior vs actual behavior?
- What are the reproduction steps?
- What is the suspected root cause?
- What regression tests are needed?

### Phase 2: Requirements Deep Dive

For each feature area, ask about:
- **Happy Path**: What happens when everything works correctly?
- **Edge Cases**: Empty inputs, max values, null/undefined, concurrent access
- **Error Scenarios**: What happens when things fail? What error messages?
- **Non-Functional Requirements**: Performance targets, security needs, scalability, logging
- **Data Requirements**: Entity definitions, constraints, relationships
- **Integration Points**: External APIs, services, databases

Use clear requirement keywords: **must**, **shall**, **will**, **should**.

### Phase 3: Quality Gates (MANDATORY)

**Always ask about quality gate commands** -- these are the commands that EVERY feature must pass. They become the `verification_steps` in feature_list.json.

Ask:
- "What is the **build command**?" (e.g., `dotnet build`, `npm run build`, `go build ./...`)
- "What is the **test command**?" (e.g., `dotnet test`, `npm test`, `pytest`)
- "Any **linting or type-checking** commands?" (e.g., `npm run lint`, `dotnet format --verify-no-changes`)
- "Any **other verification** needed?" (e.g., `npm run typecheck`, `cargo clippy`)

Include these in a dedicated **Quality Gates** section in the PRD. The Initializer will embed them into every feature's `verification_steps`.

### Phase 4: Test Requirements (MANDATORY)

Every PRD must specify what needs testing:
- **Unit Tests**: Business logic, data validation, service methods, utility functions
- **Integration Tests**: API endpoints, database operations, service interactions
- **E2E Tests** (if applicable): UI workflows, user journeys, form submissions

### Phase 5: Dependency Analysis

Determine the order features should be implemented:
- What entities/models need to exist first?
- What services depend on other services?
- What infrastructure setup is required?
- What shared components are needed?

This ordering informs how the Initializer creates features.

---

## Integration with Ralph

After the PRD is written:
1. User saves it as `prd.md` in their project root
2. Run `ralph init` to decompose into features
3. The Initializer reads the PRD using the feature sizing rules from this skill
4. Validation phase ensures 95%+ coverage of all requirements
