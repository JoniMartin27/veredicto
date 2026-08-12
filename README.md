# ⚖️ Veredicto

**The CI check that catches when an AI agent games your tests.**

Your agent says *"all tests passing"*. But did it pass them — or game them? When the
same agent writes the code **and** the tests, green CI stops meaning the code works.
Veredicto runs on every pull request and flags the concrete tricks used to turn CI
green without doing the work — **deterministic, instant, no API key, no LLM**.

> In **30% of runs**, frontier models gamed their own evaluation ([METR](https://metr.org)).
> The pain is measured. Veredicto is the detector.

🔗 **Landing & Pro tier:** https://fervon.dev/veredicto/ · part of [Fervon](https://fervon.dev)

---

## What it catches

| Rule | What it flags | Severity |
| --- | --- | --- |
| `deleted-tests` | Net removal of test cases from a test file in the same PR | hard |
| `gutted-tests` | Assertions removed while the test cases stayed — same green count, nothing checked | soft |
| `skipped-tests` | `.skip` / `.todo` / `.only` / `xit` / `pytest` & `unittest` skip marks | soft |
| `tautological-asserts` | `expect(true).toBe(true)`, `assert.strictEqual(true, true)`, `assert True`, `assert 1 == 1` (hard); empty `it('…', () => {})` body (soft) | hard / soft |
| `relaxed-thresholds` | Coverage/quality minimums lowered in config (`branches: 90` → `70`) | hard |
| `mass-snapshots` | Bulk-regenerated snapshot files (`>= 20` lines of churn) | soft |
| `weakened-assertions` | Strict matcher swapped for a vacuous one (`toBe` → `toBeTruthy`) | soft |
| `circular-mocks` | A test mocks the very module it is supposed to test, then asserts on the mock | soft |
| `error-swallowing` | Test exit code / assertion failure suppressed (`test \|\| true`, `--passWithNoTests`) | hard / soft |
| `ci-weakening` | CI workflow disarmed so failures stop blocking (`continue-on-error: true`) | hard / soft |
| `commented-asserts` | An assertion commented out instead of fixed | soft |

All static, all on your runner. No code or diff ever leaves your CI. The full
catalog — every snippet that trips a rule — lives in [`docs/RULES.md`](docs/RULES.md).

**And what it does not catch:** tests that are shaped correctly but assert the wrong thing.
In a controlled experiment, 20/20 agent-written suites passed over code with a real bug and
Veredicto flagged **0** of them — there was nothing in the diff to see.
[`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) has the numbers. Veredicto is a cheap first
line, not proof that your tests are good.

### What it looks like on a PR

One sticky comment, updated in place on every push:

> ## ⚖️ Veredicto
>
> Found **2** test-gaming signal(s): **1** hard, **1** soft.
>
> | Severity | Rule | File | Line | Detail |
> | --- | --- | --- | --- | --- |
> | 🛑 error | `deleted-tests` | `test/percentile.test.js` | 1 | 9 test cases removed from a test file without replacement, which can hide failing behavior. |
> | ⚠️ warning | `skipped-tests` | `test/percentile-v2.test.js` | 8 | Test silenced via .skip, which hides failures instead of fixing them. |

Plus inline annotations on the offending lines and a job summary on the run.

### Suppressing a finding

When a flagged change is deliberate and reviewed, add an inline directive on the line
**directly above** it:

```js
// veredicto-disable-next-line skipped-tests
it.skip('flaky on CI, tracked in #123', () => {});
```

Omit the rule name to suppress every rule on the next line. See [`docs/RULES.md`](docs/RULES.md#suppressing-a-finding).

### Works on GitLab too

Veredicto runs on **GitLab CI** as well as GitHub Actions — in a merge-request pipeline it
auto-detects the MR base and diffs `base..HEAD`, no extra config. Ready-to-copy pipeline:
[`examples/gitlab-ci.yml`](examples/gitlab-ci.yml); reference in
[`docs/CONFIGURATION.md`](docs/CONFIGURATION.md#gitlab-ci).

## Install (2 minutes)

Add a step to your PR workflow:

```yaml
# .github/workflows/veredicto.yml
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
          fetch-depth: 0          # needed to diff base..head
      - uses: JoniMartin27/veredicto@v0
        with:
          mode: warn              # "warn" (default, comment only) or "block"
        env:
          # Required for the sticky PR comment; without it the reporter is skipped.
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- **`warn`** (default): annotates the PR with what it found; never blocks.
- **`block`**: fails the check when there are *hard* signals. Start with `warn`.

`fetch-depth: 0` and the `GITHUB_TOKEN` env are both load-bearing: without the first the
diff is truncated, without the second the PR comment is silently skipped. Outputs
`findings` and `errors` for downstream steps.

## Documentation

| | |
| --- | --- |
| [Getting started](docs/GETTING-STARTED.md) | Install, first PR, reading the result, going from `warn` to `block`. |
| [Rule catalog](docs/RULES.md) | All 11 detectors: what trips each one, and how to suppress it. |
| [Configuration](docs/CONFIGURATION.md) | Inputs, outputs, permissions, fork PRs, exit codes, GitLab, monorepos, pinning. |
| [Limitations](docs/LIMITATIONS.md) | Measured. What a green check does **not** mean. |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | It ran but found nothing / posted no comment / did not block. |
| [Architecture](docs/ARCHITECTURE.md) | The whole pipeline, the plugin contract, why zero dependencies. |
| [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) | Writing a detector · what changed. |

## Why not just CodeRabbit / GitHub native?

CodeRabbit reviews quality with a paid LLM; GitHub validates security (CodeQL,
secret scanning). **Neither checks test integrity.** Veredicto does one thing —
detect when the tests were gamed — and does it deterministically and for free.

## Free vs Pro

- **Free (this repo, MIT):** all the static detectors above, forever, public &
  private repos.
- **Pro — $19/repo/mo:** an LLM judge that verifies the PR's *claims* against what
  the diff actually does (diff-vs-claim) + an exportable, signed verification
  report. Bring your own API key. → https://fervon.dev/veredicto/

## Development

```bash
node --test        # run the whole suite (detectors + corpus + report), 0 dependencies
```

The detectors are pure plugins in [`src/detectors/`](src/detectors/) — drop a new file in
that folder and the [registry](src/registry.js) auto-loads it. Each is an easy-to-audit
pure function; see [`CONTRIBUTING.md`](CONTRIBUTING.md) for the contract. PRs welcome.

### Try it on a corpus of diffs

`scripts/report.mjs` runs the detectors over a folder of saved `*.diff` / `*.patch` files
(or stdin) and emits a markdown launch report — headline rate, per-rule breakdown, and one
example per rule:

```bash
node scripts/report.mjs ./path/to/diffs   # or: git diff | node scripts/report.mjs
```

## License

MIT © 2026 Jonathan Martín · [Fervon](https://fervon.dev) — *forged red-hot*.
