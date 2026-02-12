---
description: '[Brief description of these rules]'
paths:
  - "[Glob pattern, e.g., **/*.cs, **/*.ts, **/*.py]"
---

# [Technology/Domain] Development Instructions

<!--
═══════════════════════════════════════════════════════════════════════════════
INSTRUCTIONS FILE TEMPLATE FOR RALPH-RLM-FRAMEWORK

This file provides domain-specific coding standards and best practices
that Ralph agents follow during implementation. Place instruction files in
the `instructions/` directory at the framework root.

HOW RALPH USES THIS:
- The Initializer reads instructions to understand coding standards
- The Implementer follows these guidelines when writing code
- Instructions are loaded based on file patterns (applyTo) matching the project

HOW TO CREATE YOUR OWN:
1. Copy this template
2. Name it: {technology}.instructions.md (e.g., python.instructions.md)
3. Fill in each section relevant to your tech stack
4. Delete sections that don't apply
5. Place in the instructions/ directory
═══════════════════════════════════════════════════════════════════════════════
-->

## Code Style and Structure

- [Language-specific coding conventions]
- [Preferred patterns and idioms]
- [Import/using organization]

## Naming Conventions

- [Class/type naming rules]
- [Variable/field naming rules]
- [File naming rules]

## Project Structure

- [Directory organization]
- [File placement rules]
- [Module/package structure]

## Error Handling

- [Exception handling patterns]
- [Error response format]
- [Logging requirements]

## Testing

- [Test framework to use]
- [Test naming conventions]
- [Test organization]
- [What to test and what not to test]

## Performance

- [Caching strategies]
- [Async patterns]
- [Common optimizations]

## Security

- [Authentication patterns]
- [Input validation rules]
- [Secrets management]

## Dependencies

- [Package manager to use]
- [Version pinning rules]
- [Approved libraries]
