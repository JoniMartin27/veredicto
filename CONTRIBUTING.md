# Contributing to Veredicto

Veredicto is a plugin system: every rule is a self-contained file in `src/detectors/`.
The registry auto-loads each one — there is **no wiring to touch**. Adding a rule means
writing one detector file and one test file. This guide walks through the contract.

## Zero dependencies

Veredicto runs on a CI runner with **only Node builtins and `git`** — no `node_modules`.
Do not add runtime dependencies. Detectors must be pure, synchronous functions of the
parsed diff: no filesystem, no network, no environment, no throwing.

The code and all user-facing messages are in **English**.

## The detector contract

Create `src/detectors/<rule>.js` exporting exactly this shape:

```js
'use strict';

module.exports = {
  rule: 'kebab-case-name',   // unique, stable id; matches the filename
  detect(files) {            // files = output of parseDiff(diff)
    const findings = [];
    // ...inspect files, push findings...
    return findings;
  },
};
```

### Input: `files`

`detect` receives the output of `parseDiff` (see [`src/diff.js`](src/diff.js)):

```js
files: Array<{
  file: string,                                    // path in the new tree
  added: Array<{ line: number, content: string }>, // added (+) lines; line = new-file line no.
  removed: Array<{ content: string }>,             // removed (-) lines
}>
```

`content` is the raw line **without** the leading `+`/`-`. Only changed files appear, and
only files with a resolvable path.

### Output: a `Finding`

Push zero or more findings:

```js
{
  rule: 'kebab-case-name',         // same id as `rule`
  severity: 'error' | 'warning',   // error = hard signal (can block in `block` mode)
                                    // warning = soft signal (annotates only)
  file: 'path/to/file',            // the file the finding refers to
  line: 42,                        // line in the NEW file (use a.line from the matching
                                   // added line, or 1 when not applicable)
  message: 'One English sentence explaining why this is test-gaming.',
}
```

- **`severity`**: use `error` only for patterns that are almost never legitimate
  (deleting tests, lowering coverage gates, disarming CI). Use `warning` for suspicious
  but sometimes-valid changes.
- **`line`**: prefer the `line` of the matching added line so the PR annotation lands in
  the right place; fall back to `1`.
- **`message`**: a single sentence, in English, explaining the gaming pattern.

## Golden rule: avoid false positives

A false positive (flagging legitimate code) is **worse** than a miss. Your rule must not
fire on ordinary, honest changes. Practical tactics used by the existing detectors:

- **Scope by file type.** Most rules only inspect test files, config files, snapshot
  files, or CI workflows — and ignore everything else.
- **Require two independent signals.** e.g. `circular-mocks` only fires when *both* a
  self-mock *and* an assertion-on-mock appear in the same file.
- **Pair removals with additions.** e.g. `relaxed-thresholds` compares the old and new
  number for the same key; `weakened-assertions` ties a removed strict matcher to an
  added weak one by shared subject.
- **Anchor patterns tightly.** Match whole words and call forms, not loose substrings,
  so prose or unrelated identifiers don't trip the rule.

## Tests are required

Add `test/detectors/<rule>.test.js` using `node:test`. At minimum:

- **one positive case** — a diff that your rule detects (assert it returns findings), and
- **one negative case** — clean / ordinary code that must yield **zero** findings.

Import `parseDiff` and your detector with `require`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseDiff } = require('../../src/diff');
const detector = require('../../src/detectors/<rule>');

test('flags the gaming pattern', () => {
  const diff = [
    'diff --git a/foo.test.js b/foo.test.js',
    '--- a/foo.test.js',
    '+++ b/foo.test.js',
    '@@ -1,0 +1,1 @@',
    "+  it.skip('todo', () => {});",
  ].join('\n');
  const findings = detector.detect(parseDiff(diff));
  assert.ok(findings.length >= 1);
  assert.strictEqual(findings[0].rule, '<rule>');
});

test('ignores clean code', () => {
  const diff = [
    'diff --git a/foo.test.js b/foo.test.js',
    '--- a/foo.test.js',
    '+++ b/foo.test.js',
    '@@ -1,0 +1,1 @@',
    "+  it('works', () => { expect(sum(2, 2)).toBe(4); });",
  ].join('\n');
  assert.strictEqual(detector.detect(parseDiff(diff)).length, 0);
});
```

Run the suite until green:

```bash
node --test
# or just your file:
node --test test/detectors/<rule>.test.js
```

## Documentation

When you add a rule, also add a section to [`docs/RULES.md`](docs/RULES.md) following the
existing template: what it detects, severity, a snippet that triggers it, and the
`veredicto-disable-next-line <rule>` suppression example. Keep the summary table at the
top in sync.

## Checklist before opening a PR

- [ ] `src/detectors/<rule>.js` exports `{ rule, detect }` and uses `'use strict'`.
- [ ] Detector is pure, synchronous, zero-dependency, and never throws.
- [ ] `test/detectors/<rule>.test.js` has at least one positive and one negative case.
- [ ] `node --test` is green.
- [ ] A section was added to `docs/RULES.md` (and the table updated).
- [ ] You did not edit the core (`src/index.js`, `src/registry.js`, `src/diff.js`).

Thank you for helping keep green CI honest.
