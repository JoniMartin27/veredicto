# Limitations — what a green Veredicto check does not mean

Read this before you rely on the result. Every claim here is measured, and the measurements
are in [`reports/`](../reports/) with the scoring scripts that produced them.

## The short version

Veredicto catches **blatant** test-gaming: the mechanical moves that are visible as text in
a diff. It does **not** catch tests that are *shaped* correctly but verify the wrong thing.
A green check means "nobody deleted, skipped, disarmed or vacuously asserted anything in
this diff". It does not mean "these tests would catch a bug".

## What it provably misses: the semantic mirror

The dominant failure mode of agent-written tests is not a trick you can grep for. It is the
agent writing tests that **mirror the implementation** — asserting whatever the code
currently returns, bug included.

We ran the controlled experiment ([`reports/experiment-ai-writes-tests.md`](../reports/experiment-ai-writes-tests.md)):
20 pure modules, each with a documented contract and a real, behaviourally-observable bug,
no tests. An agent was asked to write a test suite and leave the build green.

| Result | Measured |
| --- | --- |
| Suites that passed **despite the bug** (false confidence) | 20/20 (100%) |
| Suites that **pinned** the bug — asserting the buggy output, so fixing the bug turns the suite red | 15/20 (75%) |
| Suites that caught the bug | 0/20 (0%) |
| **Suites Veredicto flagged statically** | **0/20 (0%)** |

Veredicto flagged none of them, and that is not a bug in the detectors. There was nothing
to see: no deletion, no skip, no mock, no tautology. The suites were well-formed, readable,
and wrong. One agent even wrote a comment noting that the expected value "exhibits the bug".

**This is the honest boundary of what Veredicto is.** Catching the semantic mirror
requires comparing the tests against the *intent* — the contract, the PR description, the
ticket — not against the diff's syntax. Veredicto does not do that, and there is no other
edition of it that does. It is a lint, deliberately, not a proof. If you need the
intent-level check, that is a human reviewer or mutation testing, not this tool.

## It is not mutation testing

The real measure of whether a test suite has power is **mutation testing**: change the code
on purpose and see whether any test goes red. It is also expensive — minutes to hours per
run, and real infrastructure.

Veredicto is the opposite trade: seconds, zero setup, zero dependencies, runs on every PR.
Use it as the first line. If your suite protects something that matters, mutation testing
is still the tool that tells you whether the tests work. Veredicto does not replace it and
does not claim to.

## It only ever sees the diff

Detectors receive the added and removed lines of the pull request, taken with
`--unified=0`. They never read the rest of the file, the repository, or the test results.
Consequences worth knowing:

- A test that was **already** vacuous before this PR is invisible. Veredicto reviews the
  change, not the codebase.
- A pattern split across an added line and an untouched line is invisible: with no context
  lines there is nothing to pair against.
- A suppression directive only counts if the PR **adds** it. A directive that already
  existed in the file is not in the diff and has no effect.
- Renames and moves are seen as removals plus additions. `deleted-tests` cancels a test
  case that reappears under the same title in another test file of the same diff, but a
  test that moves **and** is renamed in the same PR still reads as a deletion.

## Known false positives

Kept honest on purpose — a rule that never fires is not precision.

- **`deleted-tests` on a same-PR rename.** Cancelling is title-based, so deleting
  `it('sums items')` and adding `it('adds line items')` elsewhere reads as a deletion.
  Suppress with `// veredicto-disable deleted-tests` and a reason.
- **`gutted-tests` on genuine cleanup.** Removing one truly redundant assertion fires the
  rule. That is why it is a soft signal that never blocks.
- **`mass-snapshots` on a legitimate wholesale re-baseline** — e.g. a design-system change
  that really does invalidate every snapshot. The rule cannot tell that from a lazy one;
  that is what review is for.

## What the precision looks like in practice

Across **213 real merged pull requests** from 15 of this author's repositories, Veredicto
flagged **0** and produced **0 false positives**
([`reports/corpus-own-repos.md`](../reports/corpus-own-repos.md)). Interpret that honestly:
it is strong evidence the rules do not cry wolf, and it says **nothing** about recall — a
disciplined fleet gives a detector very little to find.

Zero findings would also be what a broken detector produces, so read it next to the
evidence that it fires: 10/10 golden gamed fixtures detected, 187 tests, and deliberately
gamed pull requests run through the real Action on GitHub's runners.

> **Retracted.** An earlier version of this page cited "100 real pull requests, 2%
> flagged, 0 false positives", from a June report whose findings were never adjudicated.
> Both of those findings were **false positives** — prose read as a commented-out
> assertion — fixed in v0.3.0 and v0.3.3. Do not cite the 2% figure.

## Things it deliberately does not do

- **No LLM, no network, no API key.** Nothing about your code leaves the runner. That is a
  hard design constraint, not a milestone — it is why the tool can run on private
  repositories without a trust conversation. The licence check keeps that promise too: it
  verifies a signed key locally and contacts nothing.
- **No opinion on coverage.** Veredicto flags coverage thresholds being *lowered*. It has
  no view on what your coverage should be.
- **No opinion on test quality, style, or naming.** Other tools do that.
- **It never edits your code, never pushes, never re-runs your tests.**

## If you want a stronger guarantee

Layer it. In increasing order of cost and strength: Veredicto on every PR → mutation
testing on a schedule or on the packages that matter → a human intent-level review on
changes to critical paths.
