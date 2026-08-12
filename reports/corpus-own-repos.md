# Veredicto — precision on real merged pull requests

**213 real merged pull requests. 0 flagged. 0 false positives.**

This is a **precision** measurement, not a prevalence one. It answers "how much noise
does Veredicto add to a normal review?" — the question that decides whether a CI check
survives its first week. It does **not** claim that AI agents rarely game tests; this
corpus is one author's disciplined fleet, and a clean corpus cannot measure how common
gaming is in the wild.

Measured with **v0.3.3** on 2026-08-12.

## Method

- **Corpus:** every merged pull request retrievable from 15 repositories owned by this
  author (`inferbench`, `lookspan`, `launchpad`, `trace`, `regenta-app`, `claudescope`,
  `pregon`, `trading-bot`, `cocina-barata`, `prompt-tycoon`, `comparador-pisos`,
  `quick-capture`, `portfolio`, `regenta`, `Fervon/fervon`) — 213 diffs, fetched as
  `application/vnd.github.v3.diff`, no sampling and no exclusions.
- **Analysis:** `scripts/report.mjs` over the corpus directory. It loads the **same
  detector registry the Action ships** (`src/registry.js`), so the report cannot drift
  from what runs in CI.
- **Adjudication:** every finding read by hand against the source line.

Reproduce it:

```bash
node scripts/report.mjs ./corpus/
```

## Result

| | |
| --- | ---: |
| Pull requests analysed | 213 |
| Flagged | 0 |
| True positives | 0 |
| **False positives** | **0** |

## The one finding, and why it is gone

An earlier run of this corpus flagged exactly one line — and it was wrong:

```
packages/api/src/routes/export.ts:28
/** Flatten a Trace into the flat record the CSV columns expect. */
```

A JSDoc sentence, not a disabled assertion. `commented-asserts` accepted the keyword
followed by a dot as a method call (`expect.toBe`), and an English sentence that simply
*ends* in the word `expect` puts a full stop in exactly that position. The rule now
requires an identifier character after the dot. Fixed in v0.3.3 with this line as its
regression test.

An older run, on a 100-PR corpus in June, reported two findings and no adjudication. One
was this same line; the other was prose ending in a period, fixed in v0.3.0. Both June
findings were false positives. **The honest historical record is that the June "2% show
test-gaming" figure was 2% false positives**, and it should not be cited.

## Zero findings is not the same as doing nothing

A detector that never fires is trivially precise, so this number is only meaningful
alongside evidence that it fires when it should:

- **10/10 golden gamed fixtures** in `test/fixtures/gamed/` are detected, one per rule.
- **187 tests** covering the detectors, suppressions, CI adapters and the entrypoint.
- **Real trap pull requests in production** — `claudescope#7`, `claudescope#8` and
  `trace#35` — where the Action ran on GitHub's runners against a deliberately gamed diff
  and reported `deleted-tests`, `gutted-tests`, `skipped-tests` and
  `tautological-asserts`, with the sticky comment posted.

## What this corpus cannot tell you

- **Prevalence.** These repositories were largely produced by a supervised agent fleet
  with review discipline. A clean corpus says nothing about a team that merges agent PRs
  unread.
- **Semantic gaming.** The dominant failure mode of agent-written tests is
  implementation-mirroring — asserting the buggy output as correct — which leaves nothing
  in the diff for a static rule to see. Measured separately in
  [`experiment-ai-writes-tests.md`](experiment-ai-writes-tests.md): 20/20 agent-written
  suites passed against code with a real bug, 15/20 pinned the bug, and Veredicto flagged
  **0 of them**. See [`docs/LIMITATIONS.md`](../docs/LIMITATIONS.md).
