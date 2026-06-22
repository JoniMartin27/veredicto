# Veredicto rule catalog

Veredicto ships **10 deterministic detectors**. Each runs on your CI runner against
the PR diff only — no source ever leaves your machine, no API key, no LLM. This page
documents every rule: what it flags, its severity, a snippet that trips it, and how to
suppress a specific finding when it is a deliberate, reviewed change.

## Severity

Each finding carries a severity:

- **`error`** — a *hard* signal. In `block` mode an `error` fails the check and can
  stop the merge. These are patterns that are almost never legitimate (deleting tests,
  tautological asserts, lowering coverage gates, disarming CI).
- **`warning`** — a *soft* signal. Always surfaced as a PR annotation, but never blocks.
  These are suspicious but sometimes legitimate (skips, snapshot churn, weakened matchers).

Start in `warn` mode (the default) and move to `block` once you trust the signal.

## Suppressing a finding

When a flagged change is intentional and reviewed, add an inline directive on the line
**directly above** the offending line. The directive suppresses findings on the next
line in the new file:

```js
// veredicto-disable-next-line <rule>
it.skip('flaky on CI, tracked in #123', () => { /* ... */ });
```

- `veredicto-disable-next-line <rule>` — suppress only `<rule>` on the next line.
- `veredicto-disable <rule>` — alias, same behavior (suppresses the next line).
- Omit `<rule>` to suppress **all** rules on the next line:
  `// veredicto-disable-next-line`.

The directive works in any comment syntax the diff contains (`//`, `#`, `<!-- -->`),
because Veredicto matches the directive text anywhere on the added line. Stack multiple
directives on consecutive lines to suppress several rules. Suppressions key off
`(file, line, rule)`, so they only silence the exact finding you intend.

---

## Rule reference

| Rule | Severity | Flags |
| --- | --- | --- |
| [`deleted-tests`](#deleted-tests) | error | Net removal of test cases from a test file |
| [`skipped-tests`](#skipped-tests) | warning | `.skip` / `.todo` / `.only` / `xit` / pytest & unittest skip marks |
| [`tautological-asserts`](#tautological-asserts) | error / warning | Always-true asserts; empty test bodies |
| [`relaxed-thresholds`](#relaxed-thresholds) | error | Coverage / quality threshold lowered in config |
| [`mass-snapshots`](#mass-snapshots) | warning | Snapshot file regenerated in bulk |
| [`weakened-assertions`](#weakened-assertions) | warning | Strict matcher swapped for a vacuous one |
| [`circular-mocks`](#circular-mocks) | warning | A test mocks the module it is supposed to test |
| [`error-swallowing`](#error-swallowing) | error / warning | Test exit code / assertion failure suppressed |
| [`ci-weakening`](#ci-weakening) | error / warning | CI workflow disarmed so failures stop blocking |
| [`commented-asserts`](#commented-asserts) | warning | An assertion commented out instead of fixed |

---

### `deleted-tests`

**Severity:** `error`

Counts test-case declarations on removed (`-`) lines vs. added (`+`) lines in each test
file. If the **net** is more removals than additions, the PR is quietly dropping tests so
the suite passes (or a coverage gate eases) without the code actually working. Counting
net removals means a test that is merely moved, renamed, or rewritten in place does not
fire — only files that look like test files (`*.test.*`, `*.spec.*`, `__tests__/`,
`test_*.py`, `*_test.py`) are considered.

Triggers on:

```diff
--- a/auth.test.js
+++ b/auth.test.js
-  it('rejects an expired token', () => {
-    expect(verify(expired)).toBe(false);
-  });
```

**Suppress:**

```js
// veredicto-disable-next-line deleted-tests
it('removed: replaced by integration suite', () => {});
```

---

### `skipped-tests`

**Severity:** `warning`

Flags added lines that silence or narrow a test suite instead of fixing it:

- **JS/TS:** `it.skip` / `test.skip` / `describe.skip`, `.todo`, `.only`
  (run-narrowing), and the `xit` / `xdescribe` / `xtest` / `xspecify` disabled-spec forms.
- **Python:** `@pytest.mark.skip` / `.skipif` / `.xfail`, and `@unittest.skip` /
  `.skipIf` / `.skipUnless` / `.expectedFailure`.

It only matches deliberate skip/only/todo markers, so an ordinary `it('works', ...)`
never fires.

Triggers on:

```diff
+  it.skip('login flow', () => { /* ... */ });
+  @pytest.mark.skip(reason="todo")
```

**Suppress:**

```js
// veredicto-disable-next-line skipped-tests
it.skip('flaky on CI, tracked in #123', () => {});
```

---

### `tautological-asserts`

**Severity:** `error` (always-true assert) · `warning` (empty test body)

Flags asserts that can never fail and test bodies that assert nothing — classic ways to
make the suite green while verifying nothing.

- **`error`** — a tautological assertion where both sides of the comparison are the
  *same* literal: `expect(true).toBe(true)`, `expect(1).toBe(1)`,
  `expect("x").toEqual("x")`, `assert(true)`, `assert True`, `assert 1 == 1`.
- **`warning`** — an empty test body: `it('...', () => {})`,
  `test('...', function () {})`.

Comparing two *different* values, or a value to a variable, never fires.

Triggers on:

```diff
+  expect(true).toBe(true);
+  it('does the thing', () => {});
```

**Suppress:**

```js
// veredicto-disable-next-line tautological-asserts
expect(true).toBe(true); // placeholder until real assertion lands
```

---

### `relaxed-thresholds`

**Severity:** `error`

Pairs a removed line with an added line for the same coverage/quality key in a config
file and compares the numbers. A strict **decrease** is flagged — lowering a coverage
gate (`branches: 90` → `branches: 70`) is a classic way to turn a red build green
without adding tests. Raising a threshold, leaving it unchanged, or any non-numeric edit
never fires. Only config files are inspected: `jest.config.*`, `vitest.config.*`,
`.nycrc`, `.c8rc`, `package.json`, `sonar-project.properties`, and the keys
`branches` / `functions` / `lines` / `statements` / `global` / `minCoverage` /
`coverageThreshold`.

Triggers on:

```diff
   coverageThreshold: { global: {
-    branches: 90,
+    branches: 70,
```

**Suppress:**

```js
// veredicto-disable-next-line relaxed-thresholds
branches: 70, // temporary while migrating to new test harness
```

---

### `mass-snapshots`

**Severity:** `warning`

Flags snapshot artifacts (`*.snap` files or anything under `__snapshots__/`) whose
combined churn (added + removed lines) is **>= 20**. That much movement means the
snapshot was re-baselined wholesale rather than reviewed — a classic way to make failing
tests "pass" without inspecting what changed. Small, intentional snapshot edits stay
under the threshold and do not fire; ordinary source and test files are never considered.

Triggers on:

```diff
--- a/__snapshots__/Button.test.js.snap
+++ b/__snapshots__/Button.test.js.snap
-exports[`Button renders 1`] = `<button class="old" ...`;
+exports[`Button renders 1`] = `<button class="new" ...`;
   (… 20+ changed lines …)
```

**Suppress:**

```js
// veredicto-disable-next-line mass-snapshots
exports[`Button renders 1`] = `...`; // intentional full re-baseline
```

---

### `weakened-assertions`

**Severity:** `warning`

Within the same test file, looks for a removed line carrying a **strict** matcher whose
assertion *subject* (the `expect(...)` / `assert.equal(...,` receiver) reappears on an
added line wrapped in a **weak** matcher. Turning a precise check (`expect(x).toBe(3)`)
into a vacuous one (`expect(x).toBeTruthy()`, `.toBeDefined()`, `not.toThrow()`,
`toHaveBeenCalled()`) lets a regression slip through while the test still "passes".
Pairing on a shared subject keeps false positives near zero: an unrelated strict removal
plus an unrelated weak addition won't be paired, and a strict assertion that stays strict
(only the expected value changed) never fires.

Triggers on:

```diff
-  expect(total).toBe(42);
+  expect(total).toBeTruthy();
```

**Suppress:**

```js
// veredicto-disable-next-line weakened-assertions
expect(total).toBeTruthy(); // value is non-deterministic here
```

---

### `circular-mocks`

**Severity:** `warning`

Flags a test that mocks the very module it is supposed to be testing and then asserts on
that mock — the test no longer exercises the real implementation, so it passes regardless
of whether the code under test is correct. Two independent signals must **both** appear
in the diff for the same test file before it fires:

1. a mock whose target basename equals the module under test
   (`jest.mock("./foo")` / `vi.mock("../foo")` in `foo.test.js`; `patch("foo.bar")`
   in `test_foo.py`), **and**
2. an assertion that references a mock (`expect(mock...)`, `mock.assert_called...`,
   `toHaveBeenCalled`, …).

Mocking a *dependency* (a different module), or mocking the module under test without
asserting on the mock, never fires.

Triggers on (in `payment.test.js`):

```diff
+  jest.mock('./payment');
+  expect(payment.charge).toHaveBeenCalled();
```

**Suppress:**

```js
// veredicto-disable-next-line circular-mocks
expect(payment.charge).toHaveBeenCalled();
```

---

### `error-swallowing`

**Severity:** `error` (forced success) · `warning` (softer suppression)

Flags newly added patterns that hide a failing test instead of fixing it. Each pattern is
anchored to a test/assert context, so a legitimate `|| true`, a real error handler, or an
`exit 0` at the end of a non-test script does not fire.

- **`error`** — a test result is forcibly turned into success:
  `<test-cmd> || true`, `--passWithNoTests`, or `exit 0` right after a test command.
- **`warning`** — softer but still suspicious: `set +e` (disables shell
  fail-on-error), an empty `catch {}` around assertions, `xfail(strict=False)`, or a
  trailing `# noqa` on an assert.

Triggers on:

```diff
+    npm test || true
+  } catch {}   # around an expect(...)
```

**Suppress:**

```sh
# veredicto-disable-next-line error-swallowing
npm run test:optional || true
```

---

### `ci-weakening`

**Severity:** `error` (failures stop blocking) · `warning` (masks flakiness)

Flags PRs that quietly disarm continuous integration so a failing build or test no longer
blocks the merge. Only CI configuration files are considered (GitHub Actions workflows,
`.gitlab-ci.yml`, CircleCI configs, or anything under a `/workflows/` path), so ordinary
source or shell changes never trip this rule.

- **`error`** — adding `continue-on-error: true`, appending `|| true` / `|| exit 0`
  to a test command, or removing the line/step that actually runs the tests.
- **`warning`** — inflating a `timeout-minutes` or `retries` count to mask flakiness.

Triggers on (in `.github/workflows/ci.yml`):

```diff
   - name: Test
+    continue-on-error: true
     run: npm test
```

**Suppress:**

```yaml
# veredicto-disable-next-line ci-weakening
continue-on-error: true
```

---

### `commented-asserts`

**Severity:** `warning`

Flags added lines that **comment out** an assertion instead of fixing or removing it — a
classic move that silently disables a check while keeping the test "green". It only fires
when a comment line actually contains an assertion *call* (`expect(...)`, `assert(...)`,
`assert x == y`, a chai `.should.` form), so ordinary explanatory comments — and live,
uncommented assertions — are never flagged.

Triggers on:

```diff
+  // expect(user.role).toBe('admin');
+  # assert response.status == 200
```

**Suppress:**

```js
// veredicto-disable-next-line commented-asserts
// expect(user.role).toBe('admin'); // re-enable after RBAC ships
```

---

## See also

- [CONTRIBUTING.md](../CONTRIBUTING.md) — how to add a new detector.
- [examples/](../examples/) — ready-to-copy `warn` and `block` workflows.
