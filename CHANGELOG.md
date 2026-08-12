# Changelog

All notable changes to Veredicto. Dates are ISO. The `v0` tag always points at the latest
`v0.x` release, so `uses: JoniMartin27/veredicto@v0` picks these up automatically.

## [0.3.3] — 2026-08-12

Found by rebuilding the precision corpus from scratch — 213 real merged pull requests
across 15 repositories — and adjudicating every finding by hand instead of trusting a
report generated three releases ago.

### Fixed

- **`commented-asserts` read a sentence ending in `expect` as a method call.** The rule
  accepted the keyword followed by a dot (`expect.toBe`, `assert.strictEqual`), and an
  English sentence that *ends* in the keyword puts a full stop in exactly that position:
  `/** Flatten a Trace into the flat record the CSV columns expect. */`. That JSDoc line
  was the **only** finding across the whole corpus, and it was a false positive. The dot
  form now requires an identifier character after it. The v0.3.0 fix had covered prose
  ending in a period *after* the keyword; this is the case where the keyword itself is
  the last word.
- **The report headline could contradict its own count.** One finding in 213 pull
  requests rounds to zero, printing `0% showed test-gaming signals (1/213 flagged)`. A
  corpus with any finding now falls back to one decimal (`0.5%`); a genuinely clean
  corpus still reads as a flat `0%`.

### Changed

- `reports/corpus-own-repos.md` re-measured and rewritten: **213 PRs, 0 flagged, 0 false
  positives**, with the fetch method, the adjudication, and what the corpus *cannot* tell
  you. It also retracts the June figure — the "2% showed test-gaming" line was 2% false
  positives, both since fixed, and must not be cited.
- Test suite: 180 → 187 tests, still zero dependencies.

## [0.3.2] — 2026-08-12

### Fixed

- **In `block` mode the PR comment was never posted.** `post()` is an HTTP round-trip and
  was called without `await`, so `process.exit(1)` tore the process down with the request
  still in flight. The mode that fails your check — the one where the reader most needs to
  know *why* it went red — was the one that silently dropped the explanation. Invisible in
  `warn` mode, where the process ends on its own and Node waits for the request. Found by
  validating a real block-mode pull request: the run reported 4 signals while the sticky
  comment still showed the previous run's 3.
- `main()` is now async and awaits the reporter; the run fails via `process.exitCode`
  instead of a hard `process.exit()`, so nothing in flight is cut off. Same failing status.

## [0.3.1] — 2026-08-12

### Fixed

- **A real race in the test suite, not a flake.** `test/architecture.test.js` wrote a
  temporary detector into the shipped `src/detectors/` folder. `node --test` runs test
  files in parallel processes and the registry re-reads that folder on every `analyze()`
  call, so another test process could either pick up the ghost detector or die with
  `ENOENT` on a file that had just been unlinked. Reproduced deterministically with two
  processes: 28 crashes and 4,911 phantom findings on a clean diff in six seconds. The
  test now loads its plugin from a temp directory, and a guard test fails the build if
  anything ever writes into `src/detectors/` again.
- `loadDetectors()` / `analyze()` take an optional directory, and a detector file that
  cannot be required is skipped instead of taking the whole run down.

## [0.3.0] — 2026-08-12

The first release driven by an end-to-end audit: a throwaway git repository, a realistic
project, and one commit per gaming technique, run through the real Action entrypoint. It
found four things wrong. All four are fixed here, each with regression tests.

### Added

- **New detector `gutted-tests`** (soft). Flags a test file whose **assertions** were
  removed while the **test cases stayed** — the suite reports the same number of green
  tests and checks nothing. This was a hole, not a gap: the diff is a pure deletion, so
  `deleted-tests` (which counts declarations) saw nothing and `tautological-asserts` (which
  reads added lines) had nothing to read. Emptying a test body produced **zero** signals
  before this release.
- `tautological-asserts` now understands the **`node:assert` family**:
  `assert.strictEqual(true, true)`, `assert.equal(1, 1)`, `assert.deepStrictEqual("x", "x")`,
  `assert.ok(true)`. Previously it only knew `expect(...)`, `assert(true)` and Python
  `assert True`, so it was effectively blind on every project using `node --test`.
  `assert.notStrictEqual(true, true)` is correctly *not* flagged — that assertion fails.
- `tautological-asserts` now catches the **multi-line empty test body**, the form an agent
  actually writes:
  ```js
  test('does the thing', () => {
  });
  ```
- **Documentation set** for first contact through last detail: [getting
  started](docs/GETTING-STARTED.md), [configuration reference](docs/CONFIGURATION.md),
  [limitations](docs/LIMITATIONS.md), [troubleshooting](docs/TROUBLESHOOTING.md),
  [architecture](docs/ARCHITECTURE.md), and a [docs index](docs/README.md).
- Ready-to-copy [`examples/gitlab-ci.yml`](examples/gitlab-ci.yml). The README promised a
  GitLab pipeline example that did not exist.

### Fixed

- **Suppressing `deleted-tests` was impossible.** It reports on line 1 of the file, and the
  only documented directive (`veredicto-disable-next-line`) suppresses the line *below*
  itself — there is no line 0. The documented escape hatch for the rule most likely to
  block a merge did nothing. File-level findings are now suppressed by a
  `veredicto-disable <rule>` directive **anywhere in the same file**, and that is what the
  docs now show.
- **False positive in `commented-asserts`:** an English sentence ending in a period, such as
  `// The caller should assert the result is finite before display.`, was read as a
  commented-out assertion — the full stop counted as a "code token". The heuristic now
  requires a token that is genuinely code (a comparison operator, or a call, attribute
  access or index attached to an identifier).
- **False positive in `deleted-tests` on cross-file moves.** A test case that reappears
  under the same title in another test file of the same diff is now recognised as moved,
  not deleted. Consolidating tests no longer trips the only hard rule most people enable
  first.
- **Double reporting:** commenting an assertion out fired both `commented-asserts` and the
  new `gutted-tests`. One change should produce one signal, so `gutted-tests` stands down
  when the assertion was commented rather than dropped.
- The `GITHUB_TOKEN` environment variable was missing from the README and both example
  workflows, so the sticky PR comment was silently skipped for every user who copied them.
  The log line was `Veredicto reporter: no GITHUB_TOKEN; skipping PR comment.`

### Changed

- `src/index.js` now exports `applySuppressions` and only auto-runs as the entrypoint, so
  the suppression logic is unit-tested directly instead of through a subprocess.
- Test suite: 146 → 180 tests, still zero dependencies.

## [0.2.0] — 2026-06-22

- Plugin architecture: `src/registry.js` auto-loads every `src/detectors/*.js`.
- 10 detectors: `deleted-tests`, `skipped-tests`, `tautological-asserts`,
  `relaxed-thresholds`, `mass-snapshots`, `weakened-assertions`, `circular-mocks`,
  `error-swallowing`, `ci-weakening`, `commented-asserts`.
- Inline suppressions, sticky PR comment, job summary, `findings` / `errors` outputs.
- GitLab CI adapter, `docs/RULES.md`, `CONTRIBUTING.md`, golden corpus fixtures.
- `scripts/report.mjs` for running the detectors over a corpus of saved diffs.

## [0.1.0] — 2026-06-22

- First working GitHub Action: 6 detectors, `warn` / `block` modes, annotations, job
  summary. Node 20, zero dependencies.
