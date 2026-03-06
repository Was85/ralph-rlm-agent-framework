# C# Development Instructions

## C# Standards
- Use the latest C# features (currently C# 14)
- Write clear and concise comments for each function
- Handle edge cases and write clear exception handling

## Naming Conventions
- PascalCase for component names, method names, and public members
- camelCase for private fields and local variables
- Prefix interface names with "I" (e.g., IUserService)

## Formatting
- Apply code-formatting style defined in `.editorconfig`
- Prefer file-scoped namespace declarations and single-line using directives
- Insert a newline before the opening curly brace of any code block
- Use pattern matching and switch expressions wherever possible
- Use `nameof` instead of string literals when referring to member names
- Create XML doc comments for public APIs, include `<example>` and `<code>` where applicable

## Nullable Reference Types
- Declare variables non-nullable, and check for `null` at entry points
- Always use `is null` or `is not null` instead of `== null` or `!= null`
- Trust the C# null annotations — don't add null checks when the type system says a value cannot be null

## Data Access
- Use Entity Framework Core for data access
- Implement database migrations and data seeding
- Use efficient query patterns to avoid N+1 and other performance issues

## Validation and Error Handling
- Use data annotations for model validation
- Implement global exception handling via middleware
- Use ProblemDetails (RFC 7807) for standardized error responses

## Testing
- Always include test cases for critical paths
- Do not emit "Arrange", "Act" or "Assert" comments
- Copy existing style in nearby files for test method names and capitalization
- Use TDD: write failing test first, then implementation

## Performance
- Use async/await consistently — no `.Result` or `.Wait()`
- Implement caching strategies where appropriate
- Use pagination, filtering, and sorting for large data sets
