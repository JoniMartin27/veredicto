# Veredicto golden corpus

A standalone library of realistic PR diffs used to measure Veredicto's
**recall** (does it catch the tricks?) and **false-positive rate** (does it stay
quiet on honest changes?). The harness lives in [`test/corpus.test.js`](../corpus.test.js)
and runs every fixture here through the real pipeline: `parseDiff` -> the
auto-loading detector `registry`.

## Layout

```
test/fixtures/
  gamed/   <name>.diff + <name>.expected.json   # one per test-gaming trick
  clean/   <name>.diff + <name>.expected.json   # legitimate changes — must NOT fire
```

Each `*.diff` is a real unified diff (the exact format `git diff` emits) and is
paired with a `*.expected.json` sidecar of the same basename.

## `.expected.json` format

### Gamed fixture (a diff that demonstrates one trick)

```json
{
  "description": "Human sentence: what the diff does and why it is gaming.",
  "trick": "skipped-tests",
  "minFindings": 1,
  "expectRules": { "skipped-tests": 1 },
  "cleanExpectedZero": false
}
```

| field | meaning |
|---|---|
| `description` | One English sentence describing the diff. Required, non-empty. |
| `trick` | The kebab-case id of the gaming pattern this fixture demonstrates. |
| `minFindings` | Lower bound on total findings across all detectors (`>= 1`). |
| `expectRules` | Map of `rule -> minimum times it must fire`. Each value `>= 1`. |
| `cleanExpectedZero` | Always `false` for gamed fixtures. |

### Clean fixture (a legitimate change that must stay silent)

```json
{
  "description": "Why this change is honest and must not trip any rule.",
  "minFindings": 0,
  "cleanExpectedZero": true
}
```

| field | meaning |
|---|---|
| `description` | One English sentence. Required, non-empty. |
| `minFindings` | Always `0`. |
| `cleanExpectedZero` | Always `true`. The harness asserts EXACTLY zero findings. |

## How the harness uses these

- **Structure** of every fixture is validated unconditionally (valid JSON,
  required fields, the diff parses to at least one file) — so the corpus is
  meaningful even before any detector ships.
- **Gamed fixtures** assert a *lower bound* per rule (`expectRules[rule] >= N`).
  A fixture's recall check only runs once its target detector(s) are loaded by
  the registry; before that (e.g. early in the Integrate phase) the check is
  skipped rather than failing. Lower bounds mean adding more detectors never
  breaks an existing gamed fixture.
- **Clean fixtures** assert **exactly zero** findings against whatever detectors
  are currently loaded. This is the false-positive tripwire: a new or modified
  detector that fires on legitimate code fails here. Clean fixtures deliberately
  include *near-miss* traps (prose comments mentioning "assert"/"should", a
  renamed test that nets zero, a raised coverage threshold, a small snapshot
  edit, `|| true` on a non-test command, an empty catch with no assertion,
  mocking a dependency rather than the module under test).

## Adding a fixture

1. Drop a realistic `<name>.diff` into `gamed/` or `clean/`.
2. Add the matching `<name>.expected.json` using the format above.
3. Run `node --test test/corpus.test.js` and iterate to green.

Keep diffs small and self-explanatory; the value of the corpus is that each
fixture isolates one believable scenario.
