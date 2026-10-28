# Branch protection (proposed, not applied)

Nothing in this file has been run. Applying it changes GitHub settings, so it waits for the repository owner's approval.

## What it enforces on `main` and `develop`

* A pull request is required; nobody pushes straight to the branch. Zero approvals are required, because this repository has one maintainer and one required approval would lock them out; the point is that the checks run before the merge.
* These checks must pass, on an up-to-date branch: `lint`, `typecheck`, `build`, `test (20)`, `test (24)`, `audit`, `openapi`, and CodeQL (`Analyze (javascript-typescript)`).
* Conversations on the pull request must be resolved.
* No force pushes, no deleting the branch.
* Administrators are **not** exempt (`enforce_admins: true`), so the rule also binds the owner. For an emergency bypass, switch it off for that one change and back on afterwards.

The check names are the job names in `.github/workflows/ci.yml` and `codeql.yml`. A required check that has never run on the branch shows as "waiting" forever, so merge this pull request once with the checks not yet required, let CI and CodeQL run, then apply the rule.

CodeQL on a private repository needs GitHub Advanced Security. If the repository is private and that is not enabled, leave `Analyze (javascript-typescript)` out of the list below, or the rule will block every merge.

## The command

Run from a terminal where `gh` is signed in as the repository owner. `OWNER/REPO` is read from the current checkout.

```bash
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"

cat > protection.json <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "lint",
      "typecheck",
      "build",
      "test (20)",
      "test (24)",
      "audit",
      "openapi",
      "Analyze (javascript-typescript)"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

for branch in main develop; do
  gh api -X PUT "repos/$REPO/branches/$branch/protection" --input protection.json
done
rm protection.json
```

## Check it worked

```bash
gh api "repos/$REPO/branches/main/protection" --jq '{checks: .required_status_checks.contexts, force_push: .allow_force_pushes.enabled, admins: .enforce_admins.enabled}'
```

## Undo

```bash
gh api -X DELETE "repos/$REPO/branches/main/protection"
```

## Not covered here

The `production` GitHub Environment (required reviewer, deployment branches limited to `main`) already exists and is not changed by this. The new Rollback drill workflow uses the same environment, so it needs the same approval.
