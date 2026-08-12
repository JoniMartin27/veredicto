# Troubleshooting

Symptoms, the cause, and the fix. Each entry names the log line you would actually see.

## The step fails immediately with a licence error

**Look for this in the log:**

```
Veredicto: no licence key.
Veredicto: licence expired on 2026-08-01.
Veredicto: licence was issued for acme/web, not acme/api.
```

**Cause:** Veredicto is paid software and refuses to run unlicensed. It fails loudly
rather than doing nothing quietly — a check that silently analyses no code is
indistinguishable from a clean pull request, which is the one outcome a paid gate must
never produce.

**Fix, per message:**

- *no licence key* — the secret is missing or not passed through. The secret must be
  named in the step's `env`; defining it in repository settings is not enough:

  ```yaml
  - uses: JoniMartin27/veredicto@v0
    env:
      VEREDICTO_LICENSE: ${{ secrets.VEREDICTO_LICENSE }}
  ```

  Note that secrets are **not** available to workflows triggered by `pull_request` from a
  forked repository. That is a GitHub rule, not a Veredicto one. Use `pull_request_target`
  with care, or accept that fork PRs are not checked.

- *licence expired* — renew at <https://fervon.dev/veredicto/> and replace the secret.
  Runs warn about this daily for the 14 days before expiry, so it should not surprise you.

- *licence was issued for X, not Y* — the key is bound to one repository. Buy a key for
  that repository, or an `owner/*` key covering everything you own.

- *licence key signature does not verify* — the value was truncated or mangled on paste.
  Re-copy it whole; it is one line with exactly two dots.

## The check runs but finds nothing on a PR that obviously games the tests

**Look for this in the log:**

```
Veredicto: empty diff, nothing to analyze.
```

**Cause:** the runner has a shallow clone, so the base commit is missing and there is
nothing to diff against.

**Fix:** `fetch-depth: 0` on the checkout step.

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
```

If the log instead says `Veredicto: 0 signal(s)`, the diff was read fine and no rule
matched. Check [LIMITATIONS.md](LIMITATIONS.md) — if the tests were rewritten to mirror a
bug rather than deleted or skipped, no static rule can see it.

## No comment appears on the pull request

**Look for this in the log:**

```
Veredicto reporter: no GITHUB_TOKEN; skipping PR comment.
```

**Cause:** the token was not passed to the step. `permissions:` alone is not enough — the
reporter reads the token from the environment.

**Fix:**

```yaml
- uses: JoniMartin27/veredicto@v0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**If the token is there and the comment still does not appear:** check whether the PR comes
from a **fork**. GitHub gives fork `pull_request` runs a read-only token no matter what
`permissions:` says, so the comment cannot be posted. Annotations and the job summary still
work. Do not switch to `pull_request_target` to fix this — that runs untrusted code with a
writable token.

Also confirm the workflow has:

```yaml
permissions:
  pull-requests: write
```

## Annotations do not show up on the diff

Annotations need `checks: write` in `permissions:`. They appear in the **Files changed**
tab of the PR and in the run's annotations panel — not in the comment.

## `mode: block` does not fail the check

`block` only fails on **hard** (`error`) signals. If everything found was a warning —
`skipped-tests`, `mass-snapshots`, `weakened-assertions`, `circular-mocks`,
`gutted-tests`, `commented-asserts` — the check passes by design. The log tells you the
split:

```
Veredicto: 3 signal(s) (0 hard, 3 soft).
```

Severities per rule are in [RULES.md](RULES.md).

## The check is green but I want it to block merges

Failing the check is not the same as blocking the merge. After switching to `mode: block`,
add the check to branch protection: **Settings → Branches → Branch protection rules →
Require status checks to pass**, then select `veredicto`. The check must have run at least
once on the repository before GitHub offers it in that list.

## A finding is wrong

Suppress that one finding rather than removing the workflow — the directive documents the
decision in the code where the next reader will see it:

```js
// veredicto-disable-next-line weakened-assertions
expect(total).toBeTruthy(); // value is genuinely non-deterministic here
```

For `deleted-tests` and `gutted-tests`, which describe a whole file, put the directive
anywhere in that file:

```js
// veredicto-disable deleted-tests — these cases moved to the integration suite in #123
```

The directive must be on a line the PR **adds**; Veredicto only sees the diff.

If the rule is wrong in general — not just for your case — that is worth an issue. False
positives are treated as bugs.

## My suppression is ignored

Three usual causes:

1. **The directive is on a line the PR does not add.** Veredicto only sees the diff.
2. **Wrong anchor for a file-level rule.** `deleted-tests` and `gutted-tests` report on
   line 1; the `-next-line` form has nothing to anchor to. Use the bare
   `veredicto-disable <rule>` form anywhere in the file.
3. **Rule name typo.** It must match the rule id exactly, e.g. `tautological-asserts`, not
   `tautological-assert`. Omit the name entirely to suppress everything on the next line.

## It flags a file that is not a test

Most rules only look at paths that match `*.test.*`, `*.spec.*`, `__tests__/`,
`test_*.py`, `*_test.py`; `relaxed-thresholds` only looks at known config files, and
`ci-weakening` only at CI configs. If your project uses a different convention, the rules
will not fire on it — and if it fires on something genuinely unrelated, that is a bug worth
reporting with the diff that caused it.

## The run warns about Node 20 being deprecated

```
Node.js 20 is deprecated. The following actions target Node.js 20 but are being
forced to run on Node.js 24: actions/checkout@v4, JoniMartin27/veredicto@v0
```

**Harmless, and there is nothing to do.** `action.yml` declares `using: node20`; current
runners execute it on Node 24 regardless, and Veredicto only uses built-ins that behave
identically on both. The declaration stays at `node20` on purpose so the action keeps
working on older and self-hosted runners that do not ship Node 24 yet. `actions/checkout@v4`
prints the same notice for the same reason.

## I want to see what it would say before opening a PR

Run it against a local diff. No install, no dependencies:

```bash
git clone --depth 1 https://github.com/JoniMartin27/veredicto.git /tmp/veredicto
git diff origin/main...HEAD > /tmp/pr.diff
node /tmp/veredicto/scripts/report.mjs /tmp/pr.diff
```

`scripts/report.mjs` also accepts a folder of `*.diff` / `*.patch` files, or stdin, and
prints a markdown report with a per-rule breakdown.

## Still stuck

Open an issue with the workflow file, the relevant log lines, and — if you can share it —
the diff that did or did not fire: https://github.com/JoniMartin27/veredicto/issues
