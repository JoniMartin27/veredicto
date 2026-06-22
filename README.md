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
| `deleted-tests` | Test cases removed from a test file in the same PR | hard |
| `skipped-tests` | `.skip` / `.todo` / `xit` / `.only` / `pytest.mark.skip` | soft |
| `tautological-assert` | `expect(true).toBe(true)`, `assert True`, `expect(2).toBe(2)`… | hard |
| `empty-test` | `it('…', () => {})` with no assertions | soft |
| `relaxed-threshold` | Coverage/quality minimums lowered in config | hard |
| `mass-snapshots` | Bulk-regenerated snapshot files | soft |

All static, all on your runner. No code or diff ever leaves your CI.

## Install (2 minutes)

Add a step to your PR workflow:

```yaml
# .github/workflows/veredicto.yml
name: Veredicto
on: pull_request

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
```

- **`warn`** (default): annotates the PR with what it found; never blocks.
- **`block`**: fails the check when there are *hard* signals. Start with `warn`.

Outputs `findings` and `errors` for downstream steps.

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
node --test        # run the detector unit tests (0 dependencies)
```

The detectors are pure functions in [`src/detectors.js`](src/detectors.js) — easy to
read, easy to extend, easy to audit. PRs welcome.

## License

MIT © 2026 Jonathan Martín · [Fervon](https://fervon.dev) — *forged red-hot*.
