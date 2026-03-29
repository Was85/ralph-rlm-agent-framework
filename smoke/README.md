This folder keeps the active end-to-end smoke fixtures for Ralph.

Kept on purpose:
- `todo-api-e2e`: source PRD fixture for greenfield smoke runs
- `todo-api-e2e-team-baseline`: plain directory snapshot of the team smoke starting point after `F002`
- `todo-api-e2e-phase4-run`: completed sequential proof snapshot kept for inspection and documentation

These fixtures are committed as normal directories, not nested git repos. The smoke wrapper initializes temporary repos from them at runtime so the workflow stays reproducible after a clean checkout.
