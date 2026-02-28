---
name: test-driven-development
description: Enforces Red-Green-Refactor TDD cycle during implementation. Write the test first, watch it fail, write minimal code to pass. No production code without a failing test first.
user-invocable: false
---

# Skill: Test-Driven Development (TDD)

> Write the test first. Watch it fail. Write minimal code to pass.

**Core principle:** "If you didn't watch the test fail, you don't know if it tests the right thing."

---

## When to Apply

**Always use TDD for:**
- New features
- Bug fixes
- Refactoring
- Behavior changes

**Exceptions (only with human approval):**
- Throwaway prototypes
- Generated code (scaffolding, migrations)
- Configuration files

Thinking "skip TDD just this once"? Stop. That's rationalization.

---

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Wrote code before the test? **Delete it. Start over.**

No exceptions:
- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Don't look at it
- Delete means delete

Implement fresh from tests. Period.

---

## Red-Green-Refactor Cycle

### 1. RED - Write Failing Test

Write ONE minimal test demonstrating desired behavior.

Requirements:
- Tests one behavior only
- Clear, descriptive name
- Uses real code (mocks only when unavoidable)

### 2. VERIFY RED - Watch It Fail

**MANDATORY. Never skip.**

```bash
# Run the specific test
dotnet test --filter "TestName"
npm test path/to/test
pytest path/to/test.py
```

Confirm:
- Test **fails** (not errors from typos)
- Failure message matches what you expect
- Fails because the feature is missing

### 3. GREEN - Write Minimal Code

Write the **simplest** code that makes the test pass. Nothing more.

- Don't add features beyond what the test requires
- Don't refactor other code
- Don't "improve" beyond what the test checks

### 4. VERIFY GREEN - Watch It Pass

**MANDATORY.**

```bash
# Run all tests, not just the new one
dotnet test
npm test
pytest
```

Confirm:
- New test passes
- All existing tests still pass
- Output clean (no errors, no warnings)

### 5. REFACTOR - Clean Up (Optional)

Only after green:
- Remove duplication
- Improve names
- Extract helpers

**Keep tests green.** Don't add behavior during refactoring.

### 6. REPEAT

Next failing test for next behavior. Continue the cycle.

---

## Good Tests

| Quality | Good | Bad |
|---------|------|-----|
| **Minimal** | Tests one thing. "and" in name? Split it. | `test('validates email and domain and whitespace')` |
| **Clear** | Name describes behavior | `test('test1')` |
| **Shows intent** | Demonstrates desired API | Obscures what code should do |
| **Real code** | Uses actual implementations | Mocks everything |

---

## Why Test-First Matters

**"I'll write tests after"** -- Tests written after pass immediately. Passing immediately proves nothing. You never saw the test catch anything.

**"Already manually tested"** -- Manual testing is ad-hoc. No record, can't re-run, easy to miss cases.

**"Deleting work is wasteful"** -- Sunk cost fallacy. Working code without real tests is technical debt.

**"TDD is dogmatic"** -- TDD IS pragmatic. Finds bugs before commit, prevents regressions, documents behavior, enables safe refactoring.

**"Tests after achieve same goals"** -- Tests-after ask "what does this do?" Tests-first ask "what should this do?" Tests-after are biased by your implementation.

---

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. |
| "I'll test after" | Tests passing immediately prove nothing. |
| "Need to explore first" | Fine. Throw away exploration, start with TDD. |
| "Test hard = skip it" | Hard to test = hard to use. Fix the design. |
| "TDD will slow me down" | TDD is faster than debugging. |
| "Existing code has no tests" | You're improving it. Add tests now. |

---

## Red Flags - STOP and Start Over

If any of these happen, delete code and restart with TDD:

- Code written before test
- Test written after implementation
- Test passes immediately (never saw it fail)
- Can't explain why test failed
- Rationalizing "just this once"

---

## Bug Fix Workflow

Bug found? Follow this exact sequence:

1. **RED**: Write a failing test that reproduces the bug
2. **VERIFY RED**: Confirm test fails showing the bug
3. **GREEN**: Fix the bug with minimal code
4. **VERIFY GREEN**: Test passes, bug is fixed, no regressions

Never fix bugs without a test. The test proves the fix and prevents regression.

---

## Verification Checklist

Before marking a feature complete:

- [ ] Every new function/method has a test
- [ ] Watched each test fail before implementing
- [ ] Each test failed for expected reason (feature missing, not typo)
- [ ] Wrote minimal code to pass each test
- [ ] All tests pass
- [ ] Output clean (no errors, warnings)
- [ ] Tests use real code (mocks only if unavoidable)
- [ ] Edge cases and error paths covered

Can't check all boxes? You skipped TDD. Start over.

---

## When Stuck

| Problem | Solution |
|---------|----------|
| Don't know how to test | Write the API you wish existed. Write assertion first. |
| Test too complicated | Design too complicated. Simplify the interface. |
| Must mock everything | Code too coupled. Use dependency injection. |
| Test setup is huge | Extract helpers. Still complex? Simplify the design. |

---

## Integration with Ralph

The TDD skill works alongside Ralph's implementation loop:

1. **Feature has acceptance criteria with test names** -- Use those as your RED targets
2. **Write the failing test first** -- Before any production code
3. **Minimal GREEN implementation** -- Just enough to pass
4. **Run full test suite** -- All tests must pass before marking feature complete
5. **If tests fail, log and exit** -- Ralph's loop will retry with fresh context

The TDD cycle maps directly to Ralph's "failure is data" philosophy: each RED-GREEN cycle produces provable, testable progress.

---

## Attribution

Adapted from [obra/superpowers](https://skills.sh/obra/superpowers/test-driven-development) TDD skill by Jesse Vincent.
