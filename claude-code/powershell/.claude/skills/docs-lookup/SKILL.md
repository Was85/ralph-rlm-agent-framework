---
name: docs-lookup
description: API verification guidelines for looking up documentation before writing code. Prevents incorrect API usage, deprecated methods, and wrong method signatures.
user-invocable: false
---

# Skill: docs-lookup

> Verify API accuracy using documentation tools before writing code.

## Purpose

Prevent incorrect API usage by verifying method signatures, parameters, and patterns against official documentation before implementation. Never guess an API -- look it up.

---

## Why This Matters

- Incorrect APIs waste iterations on build errors
- Deprecated APIs create tech debt from the start
- Wrong method signatures cause runtime failures the tests catch too late
- A 30-second lookup saves a 5-minute failed iteration

---

## Verification Tools (Use in Order of Preference)

### 1. Web Search

Best for: Latest docs, community solutions, release notes, breaking changes.

```
Search: "[library name] [method/class] documentation [year]"
Search: "[library name] migration guide v[old] to v[new]"
```

### 2. WebFetch

Best for: Reading specific documentation pages you already know the URL for.

```
Fetch: https://learn.microsoft.com/en-us/dotnet/api/[namespace.class]
Fetch: https://docs.python.org/3/library/[module].html
```

### 3. Context7 MCP Server

Best for: Third-party library documentation with version awareness.

```
Query: "How to use [library] [feature] in version [X]"
```

### 4. Microsoft Learn MCP Server

Best for: Microsoft technologies (.NET, Azure, C#, ASP.NET, etc.)

```
Search: "[API name] [method]"
Code Samples: "[feature] example code"
Full Reference: Fetch full API page with overloads
```

---

## Mandatory Verification Workflow

Before using any API in implementation:

```
1. IDENTIFY what you need
   └─> Class name, method, expected behavior

2. SEARCH documentation
   └─> Use the most appropriate tool above

3. VERIFY the API exists
   └─> Check method signature, parameters, return type

4. CHECK for deprecation
   └─> Look for "Obsolete", "Deprecated", "Use X instead"

5. FIND a working example
   └─> Code samples are more reliable than guessing

6. IMPLEMENT with confidence
   └─> Now write the code
```

---

## When to Verify

- **Always**: First time using any library or API method
- **Always**: After encountering a build error related to APIs
- **Always**: When compiler warnings mention deprecation
- **Always**: When uncertain about parameter types or order
- **Always**: When migrating to a new version of a library

---

## Common Verification Scenarios

| Scenario | What to Look Up |
|----------|----------------|
| Using a new NuGet package | Package README, API reference |
| Calling an external REST API | Endpoint URL, auth method, request/response schema |
| Using a framework feature | Official docs for correct setup pattern |
| Handling specific error types | Exception hierarchy, what throws what |
| Configuring middleware | Correct order, options, and method names |
| Writing tests with a framework | Test base class, assertions, setup patterns |

---

## Anti-Patterns

- **Guessing method names** based on what seems logical
- **Assuming parameters** match a similar method in another library
- **Using Stack Overflow answers** from 3+ years ago without checking version
- **Ignoring IntelliSense warnings** about deprecated members
- **Copying patterns from one version** and assuming they work in another
