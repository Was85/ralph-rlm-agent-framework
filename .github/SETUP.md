# Repository Setup Guide

---

## Do we really need files in the repo?

Short answer: **for two things, yes — because GitHub has no UI alternative for them.**

| What | Needs a file in the repo? | Why |
|---|---|---|
| **Branch protection rules** | ❌ No | Configured entirely in GitHub Settings UI. No file involved. |
| **CODEOWNERS** | ✅ Yes | GitHub reads this file from the repo to know who must review PRs. There is no Settings UI equivalent — without the file, the "Require review from Code Owners" option does nothing. |
| **PR template** | ✅ Yes | GitHub reads this file from the repo to pre-fill new PR descriptions. There is no Settings UI equivalent. |

So: branch protection = pure config, no file needed. CODEOWNERS + PR template = must be files.

---

## What's already handled by the files in this repo

Once this PR is merged, these two files are active — GitHub reads them automatically, no CI pipeline involved:

- `.github/CODEOWNERS` → `@Was85` is auto-requested as a reviewer on every PR
- `.github/pull_request_template.md` → new PRs open with a pre-filled description checklist

---

## One-time step: enable branch protection in GitHub Settings

This is the only piece that lives in GitHub's UI, not in the repo.
Do this **once** after merging this PR.

1. Go to the repo on GitHub → **Settings** → **Branches** → **Add rule**
   (or **Add branch ruleset** in the newer UI)
2. Set **Branch name pattern** to `main`
3. Enable these options:

   | Option | Why |
   |---|---|
   | ✅ Require a pull request before merging | No direct pushes to `main` |
   | ✅ Required approvals: **1** | Every PR needs at least one approval |
   | ✅ Require review from Code Owners | Ties in the `CODEOWNERS` file — forces your review |
   | ✅ Dismiss stale reviews when new commits are pushed | Approval resets if more commits are pushed |
   | ✅ Require status checks to pass → add **CI / test** | Blocks merge if CI fails |
   | ✅ Require conversation resolution before merging | All review threads must be resolved |
   | ✅ Do not allow bypassing the above settings | Even you as admin must use a PR |
   | ❌ Allow force pushes | Off |
   | ❌ Allow deletions | Off |

4. Click **Create** (or **Save changes**)

Done. `main` is now fully protected.
