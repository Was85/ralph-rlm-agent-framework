# Product Requirements Document

## Project Overview

Build a very small REST API for managing todos. This project exists as an end-to-end smoke test for Ralph-RLM, so the implementation should stay intentionally simple while still exercising real feature decomposition, automated tests, commits, and cumulative regression verification.

The finished app should be a TypeScript Node.js service using Express. Persistence can stay in memory for this smoke test. The project must be runnable locally with standard npm scripts.

## Technical Requirements

- Use Node.js with TypeScript.
- Use Express for the HTTP API.
- Use Vitest for automated tests.
- Use Supertest or an equivalent HTTP test helper for endpoint tests.
- Use npm as the package manager.
- Provide these npm scripts:
  - `npm run build`
  - `npm test`
  - `npm run dev` is optional
- The codebase should be small, readable, and easy to verify.

## Smoke-Test Constraints For Ralph

- Keep the feature list small if possible, ideally around 6 to 8 features for this tiny project.
- Every user story must include automated tests as part of its acceptance criteria.
- Each implementation step must preserve earlier tests and extend the suite rather than replacing it.
- The build and full test suite must pass after each completed feature.
- Prefer atomic features with clear dependency ordering.
- Treat this as a real project, not a fake demo: the code and tests must actually run.

## Functional Requirements

### 1. Project bootstrap

- Initialize the Node.js project with TypeScript configuration.
- Add the required dependencies and scripts.
- Expose an Express app in a way that tests can import without starting a network listener.
- Provide a normal entrypoint so the API can run as a server.
- Add at least one smoke test proving the app can boot or respond.

### 2. Health endpoint

- Add `GET /health`.
- It should return HTTP 200 and JSON showing the service is healthy.
- Add automated tests for the endpoint.

### 3. Create and list todos

- Add `POST /todos` to create a todo.
- Add `GET /todos` to list all todos.
- A todo must contain:
  - `id`
  - `title`
  - `completed`
  - `createdAt`
  - `updatedAt`
- New todos start with `completed: false`.
- Todos should be returned in creation order.
- Add automated tests for creating and listing todos.

### 4. Read a single todo

- Add `GET /todos/:id`.
- It should return the todo when it exists.
- It should return HTTP 404 with JSON error details when the todo does not exist.
- Add automated tests for the success and not-found cases.

### 5. Update a todo

- Add `PATCH /todos/:id`.
- It must allow updating:
  - `title`
  - `completed`
- `updatedAt` must change when an update succeeds.
- It should return HTTP 404 for unknown ids.
- Add automated tests for update behavior.

### 6. Delete a todo

- Add `DELETE /todos/:id`.
- It should remove the todo and return HTTP 204 on success.
- It should return HTTP 404 for unknown ids.
- After deletion, the todo must no longer appear in `GET /todos` or `GET /todos/:id`.
- Add automated tests for delete behavior.

### 7. Validation and error handling

- `POST /todos` must reject missing or blank `title`.
- `PATCH /todos/:id` must reject invalid payloads such as empty title or wrong data types.
- Validation failures should return HTTP 400 with JSON error details.
- Not-found responses should also be JSON.
- Add automated tests covering validation behavior.

## Non-Functional Requirements

- The app must compile cleanly with `npm run build`.
- The full automated test suite must pass with `npm test`.
- Tests should run without requiring external services, databases, or environment variables.
- The implementation should be deterministic and suitable for CI.

## Out of Scope

- Authentication and authorization
- Database persistence
- Pagination
- OpenAPI generation
- Docker or deployment configuration
