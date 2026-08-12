# Configuration reference

Everything Veredicto reads and everything it writes. There is no config file: the surface
is one input, two outputs, and a handful of environment variables.

## Inputs

| Input | Values | Default | Effect |
| --- | --- | --- | --- |
| `mode` | `warn` \| `block` | `warn` | `warn` annotates and comments but always exits 0. `block` exits 1 when at least one **hard** (`error`) signal survives suppression. Soft signals never fail the check in either mode. |
| `license` | licence key | — | Fallback for workflows that cannot set environment variables. Prefer the `VEREDICTO_LICENSE` env var from a secret: an input can end up rendered in logs and in the workflow file, a secret does not. |

The `mode` value is case-insensitive; anything that is not `block` behaves as `warn`.

```yaml
- uses: JoniMartin27/veredicto@v0
  with:
    mode: block
```

## Outputs

Written to `$GITHUB_OUTPUT`, so later steps can branch on them.

| Output | Type | Meaning |
| --- | --- | --- |
| `findings` | integer | Total signals after suppressions (hard + soft). |
| `errors` | integer | Hard (`error`) signals only. |

```yaml
- uses: JoniMartin27/veredicto@v0
  id: veredicto
  with: { mode: warn }
  env: { GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }

- name: Label the PR when tests look gamed
  if: steps.veredicto.outputs.errors != '0'
  run: gh pr edit "$PR" --add-label test-integrity
```

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `VEREDICTO_LICENSE` | **always** | Your licence key. Verified offline against an embedded Ed25519 public key — never transmitted. Without a valid key the run fails immediately and analyses nothing. |
| `GITHUB_REPOSITORY` | **always** | `owner/repo`. Used for the comment API call **and** to check which repository the licence covers. On GitLab, set it to your `$CI_PROJECT_PATH`. |
| `GITHUB_TOKEN` | for the PR comment | Authenticates the sticky comment. `GH_TOKEN` and the `github-token` input are accepted as aliases. Without any of them the reporter logs `no GITHUB_TOKEN; skipping PR comment` and everything else still works. |
| `GITHUB_EVENT_PATH` | set by Actions | Source of the PR's `base.sha` / `head.sha` and the PR number. |
| `GITHUB_STEP_SUMMARY` | set by Actions | Where the job summary is appended. |
| `GITHUB_OUTPUT` | set by Actions | Where `findings` / `errors` are written. |
| `GITLAB_CI`, `CI_MERGE_REQUEST_DIFF_BASE_SHA`, `CI_COMMIT_BEFORE_SHA` | GitLab only | Select the GitLab diff source. See below. |

## Permissions

```yaml
permissions:
  contents: read        # read the code and the git history
  checks: write         # emit the annotations
  pull-requests: write  # post/update the sticky comment
```

These are least-privilege: Veredicto never writes to your repository, never pushes, and
never creates a check run of its own beyond the step's own annotations.

**Fork pull requests.** For a `pull_request` event coming from a fork, GitHub issues a
read-only `GITHUB_TOKEN` regardless of the `permissions:` block. Annotations and the job
summary still work; the sticky comment cannot be posted and is skipped without failing the
job. This is a platform rule, not a Veredicto limitation. Do **not** switch to
`pull_request_target` to work around it — that runs the fork's code with a writable token.

## Checkout requirements

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
```

Veredicto diffs `base..head`. With the default shallow checkout the base commit is often
absent from the local clone. It attempts a targeted `git fetch` of both SHAs, but a full
history is the only reliable way. Without it, expect an empty or truncated analysis — and
`Veredicto: empty diff, nothing to analyze.` in the log.

## How the diff is resolved

In order:

1. **GitLab CI** (`GITLAB_CI` set, or `CI_PROJECT_ID` present) — base is
   `CI_MERGE_REQUEST_DIFF_BASE_SHA`, falling back to `CI_COMMIT_BEFORE_SHA`; head is the
   current `HEAD`. A zero-SHA (first push) is treated as absent.
2. **GitHub pull request** — `base.sha..head.sha` read from the event payload, after
   fetching both SHAs.
3. **Fallback** — `HEAD~1..HEAD`, so a manual or push-triggered run still analyses
   something.

All diffs are taken with `--unified=0`: no context lines, one record per added or removed
line. That is why detectors see *changed* lines only and never the surrounding file — a
deliberate constraint that keeps the tool honest about what it can know.

## Exit codes

| Code | When |
| --- | --- |
| `0` | No hard signals, or `mode: warn` regardless of findings, or the diff was empty. |
| `1` | `mode: block` **and** at least one hard (`error`) signal survived suppression. |

Veredicto does not throw on malformed input: an unparseable diff yields no findings rather
than a crashed job. The PR-comment reporter is best-effort and swallows its own errors.

## Suppressions

Inline directives, applied after the detectors run. Full rules and the file-level form are
in [RULES.md → Suppressing a finding](RULES.md#suppressing-a-finding).

```js
// veredicto-disable-next-line skipped-tests
it.skip('flaky on CI, tracked in #123', () => {});
```

Suppressed findings are removed before annotations, the comment, the outputs, and the
block decision — a suppressed hard signal cannot fail the check.

## GitLab CI

```yaml
veredicto:
  image: node:20
  rules:
    - if: $CI_PIPELINE_SOURCE == 'merge_request_event'
  variables:
    GIT_DEPTH: 0 # same reason as fetch-depth: 0 on GitHub
  script:
    - git clone --depth 1 https://github.com/JoniMartin27/veredicto.git /tmp/veredicto
    - INPUT_MODE=warn node /tmp/veredicto/src/index.js
```

Annotations are a GitHub Actions feature, so on GitLab the findings arrive as job log
lines and the exit code. `mode: block` fails the job exactly as it fails the check on
GitHub.

## Monorepos

There is nothing to configure: Veredicto analyses whatever paths appear in the diff, and
every rule decides for itself whether a path is a test file, a config file, or CI. If you
only want it to run for some packages, gate the workflow with `on.pull_request.paths`
rather than trying to scope the action.

## Pinning the version

| Reference | Behaviour |
| --- | --- |
| `@v0` | Moving tag: always the latest `v0.x`. Recommended — you get new detectors and false-positive fixes automatically. |
| `@v0.3.0` | Exact release, frozen. |
| `@<full-sha>` | Immutable, the strictest supply-chain posture. |

Veredicto has **zero runtime dependencies** — it runs Node built-ins and the `git` already
on the runner — so pinning it pins the entire attack surface.
