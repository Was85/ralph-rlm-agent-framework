# Repository Setup Guide

This file describes the **one-time manual steps** needed to finish locking down the `main` branch.
Everything below is done in the GitHub website UI — no pipeline or code changes required.

---

## What's already in place (no action needed)

| File | What it does |
|---|---|
| `.github/CODEOWNERS` | Tells GitHub that `@Was85` must review every PR before it can be merged |
| `.github/pull_request_template.md` | Auto-fills a checklist whenever someone opens a PR |

These files take effect automatically once this PR is merged. No CI job runs them.

---

## One-time step: enable branch protection in GitHub Settings

Branch protection rules live in GitHub's settings, not in the repository files.
You only have to do this **once**, after merging this PR.

1. Open the repo on GitHub and click **Settings**.
2. In the left sidebar, click **Branches**.
3. Under **Branch protection rules**, click **Add rule** (or **Add branch ruleset** if you see the newer UI).
4. In **Branch name pattern**, type `main`.
5. Enable the following options:

   | Option | Why |
   |---|---|
   | ✅ Require a pull request before merging | No one can push directly to `main` |
   | ✅ Required approvals: **1** | Every PR needs at least one approval |
   | ✅ Require review from Code Owners | Forces your review specifically (via `CODEOWNERS`) |
   | ✅ Dismiss stale reviews when new commits are pushed | Approval resets if the author pushes more changes |
   | ✅ Require status checks to pass before merging | Blocks merge if CI fails |
   | &nbsp;&nbsp;&nbsp;→ Search and add: **CI / test** | This is the check that the existing `ci.yml` workflow reports |
   | ✅ Require conversation resolution before merging | All review comments must be resolved |
   | ✅ Do not allow bypassing the above settings | Even you as admin must go through a PR |
   | ❌ Allow force pushes | Off — prevents rewriting history |
   | ❌ Allow deletions | Off — no one can delete `main` |

6. Click **Create** (or **Save changes**).

That's it. From this point on, the only way to change `main` is through a PR that you approve.
