# Getting started

From nothing to a working check on your next pull request. About five minutes.

## 1. What problem this solves

When the same agent writes both the code and the tests, "all tests pass" stops being
evidence. The agent can make CI green by fixing the code — or by deleting the test that
failed, marking it `.skip`, replacing the assertion with one that cannot fail, or lowering
the coverage gate. Those moves look almost identical to honest work in a diff summary, and
they are cheap to do and tedious to spot by hand.

Veredicto reads the diff and names them. It does not judge whether your tests are *good*;
it catches the specific, mechanical ways a suite gets gamed. See [Limitations](LIMITATIONS.md)
for the honest boundary.

## 2. Install

Create `.github/workflows/veredicto.yml` in your repository:

```yaml
name: Veredicto

on: pull_request

permissions:
  contents: read
  checks: write
  pull-requests: write

jobs:
  veredicto:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # required: the full history is needed to diff base..head

      - uses: JoniMartin27/veredicto@v0
        with:
          mode: warn
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} # required for the PR comment
```

Two lines people forget, and what happens without them:

- **`fetch-depth: 0`** — without it the checkout is shallow, the base commit may be
  missing, and Veredicto silently analyses far less than the real diff.
- **`env: GITHUB_TOKEN`** — without it everything still runs, but the sticky PR comment is
  skipped and you only get inline annotations. The log says
  `Veredicto reporter: no GITHUB_TOKEN; skipping PR comment.`

Ready-to-copy files live in [`examples/`](../examples/) — `veredicto-warn.yml` and
`veredicto-block.yml`.

## 3. What you get on a pull request

Three surfaces, from most to least visible:

**A sticky comment** on the PR — one comment, updated in place on every push, never a
thread of duplicates:

> ## ⚖️ Veredicto
>
> Found **2** test-gaming signal(s): **1** hard, **1** soft.
>
> | Severity | Rule | File | Line | Detail |
> | --- | --- | --- | --- | --- |
> | 🛑 error | `deleted-tests` | `test/percentile.test.js` | 1 | 9 test cases removed from a test file without replacement, which can hide failing behavior. |
> | ⚠️ warning | `skipped-tests` | `test/percentile-v2.test.js` | 8 | Test silenced via .skip, which hides failures instead of fixing them. |

**Inline annotations** on the offending lines in the *Files changed* tab, so the finding
sits next to the code that caused it.

**A job summary** on the Actions run, for the record even after the PR is merged.

## 4. Reading the result

Every finding has a severity:

- 🛑 **`error` (hard)** — almost never legitimate: tests deleted, assertions that cannot
  fail, coverage gates lowered, CI disarmed. In `block` mode these fail the check.
- ⚠️ **`warning` (soft)** — suspicious but sometimes fine: skips, snapshot churn, weakened
  matchers, assertions removed. These are always reported and **never** block.

The check itself is green in `warn` mode no matter what it finds. That is deliberate:
Veredicto should never be the reason a merge is stuck on day one.

If a finding is wrong or the change was deliberate and reviewed, suppress that one finding
with an inline directive — see [suppressing a finding](RULES.md#suppressing-a-finding).
Suppressing is better than deleting the workflow: it leaves the reason in the code.

## 5. Graduating to blocking

Run in `warn` for a couple of weeks. When the findings look right for *your* codebase:

1. Change `mode: warn` to `mode: block`. Now hard signals fail the check; soft ones still
   only annotate.
2. Optionally make it required: **Settings → Branches → Branch protection rules → Require
   status checks to pass**, and add the `veredicto` check.

You can always go back. Nothing about Veredicto is stateful — it only ever reads a diff.

## 6. GitLab

The same code runs on GitLab CI. In a merge-request pipeline it detects
`CI_MERGE_REQUEST_DIFF_BASE_SHA` and diffs `base..HEAD` with no extra configuration. See
[Configuration → GitLab CI](CONFIGURATION.md#gitlab-ci).

## Next

- [Rule catalog](RULES.md) — what each of the 11 detectors flags.
- [Limitations](LIMITATIONS.md) — what a green Veredicto check does **not** mean.
- [Troubleshooting](TROUBLESHOOTING.md) — it ran but found nothing / posted nothing.
