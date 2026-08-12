# Architecture

What actually runs on your CI runner, in the order it runs. The whole program is ~700 lines
of Node with **zero dependencies** — it is meant to be read end to end in one sitting, and
you should read it before letting it run on a private repository.

## The pipeline

```
        pull_request event
                │
                ▼
   ┌────────────────────────┐
   │ 1. acquire the diff    │  src/index.js  → getDiff()
   │    git diff --unified=0│  src/ci/gitlab.js (GitLab only)
   └───────────┬────────────┘
               ▼
   ┌────────────────────────┐
   │ 2. parse               │  src/diff.js → parseDiff()
   │    text → per-file     │  [{ file, added[{line,content}], removed[{content}] }]
   │    added/removed lines │
   └───────────┬────────────┘
               ▼
   ┌────────────────────────┐
   │ 3. run the detectors   │  src/registry.js → analyze()
   │    auto-loaded plugins │  src/detectors/*.js  (11 today)
   └───────────┬────────────┘
               ▼
   ┌────────────────────────┐
   │ 4. apply suppressions  │  src/index.js → applySuppressions()
   └───────────┬────────────┘
               ▼
   ┌────────────────────────┐
   │ 5. report              │  ::error / ::warning annotations
   │                        │  $GITHUB_STEP_SUMMARY job summary
   │                        │  src/report/pr-comment.js  sticky comment
   │                        │  $GITHUB_OUTPUT  findings / errors
   └───────────┬────────────┘
               ▼
        exit 0, or 1 in block mode with a hard signal
```

## 1. Acquiring the diff — `src/index.js`

Resolution order: GitLab MR base → GitHub PR `base.sha..head.sha` from the event payload →
`HEAD~1..HEAD` as a fallback. Both SHAs are fetched first, because the runner's checkout may
be shallow.

Everything is taken with **`--unified=0`**: no context lines. Detectors therefore see only
what the PR changed and can never accidentally flag pre-existing code. It also means a
pattern that spans a changed line and an untouched line is invisible — a deliberate trade,
documented in [LIMITATIONS.md](LIMITATIONS.md).

`git` is invoked through `execFileSync` with an argument array — never a shell string — so
branch and file names cannot be interpreted as commands.

## 2. Parsing — `src/diff.js`

52 lines, pure, no state. Walks the unified diff and produces, per file:

```js
{
  file: 'test/cart.test.js',
  added:   [{ line: 12, content: "  it.skip('x', () => {});" }],
  removed: [{ content: "  it('x', () => { expect(a).toBe(1); });" }]
}
```

`line` is the line number in the **new** file, which is what annotations need. Removed lines
have no new-file position, so they carry only content — that is why rules built on removals
(`deleted-tests`, `gutted-tests`) report at line 1 and are suppressed file-wide.

## 3. The detector registry — `src/registry.js`

`loadDetectors()` reads every `.js` file in `src/detectors/` and keeps the ones exporting a
`detect` function. There is no manifest and no import list: **drop a file in the folder and
it is live**. `analyze(diff)` parses once and concatenates every detector's findings.

The plugin contract:

```js
module.exports = {
  rule: 'kebab-case-name',          // unique, stable id — also the suppression keyword
  detect(files) {                   // files = parseDiff(diff)
    return [{
      rule: 'kebab-case-name',
      severity: 'error' | 'warning', // error = hard (can block), warning = soft
      file: 'path/in/new/tree',
      line: 12,                      // new-file line, or 1 for a file-level finding
      message: 'One English sentence: why this is test-gaming.',
    }];
  },
};
```

Rules for detector authors — the contract itself is exercised by
[`test/architecture.test.js`](../test/architecture.test.js) (the registry auto-loads a
plugin, tolerates an empty folder, and concatenates findings); the rest is enforced by
review:

- **Pure and synchronous.** No I/O, no network, no filesystem, no `process.env`, no global
  state, no throwing. A detector gets `files` and returns findings.
- **Conservative.** A false positive is worse than a miss. The product is trusted because it
  does not cry wolf; a rule that fires on honest work costs more than the gaming it catches.
- **One change, one signal.** If two rules would describe the same edit, the more specific
  one owns it — `gutted-tests` stands down when the assertion was commented out, because
  `commented-asserts` already reports it.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full checklist.

## 4. Suppressions — `src/index.js`

Two shapes, both matched against **added** lines only:

- **Line-anchored:** `veredicto-disable-next-line <rule>` silences `<rule>` on the next line.
- **File-level:** the same directive without `-next-line` also silences findings reported at
  line 1 of that file — the only way to suppress `deleted-tests` / `gutted-tests`, which have
  no single offending line.

Omitting `<rule>` suppresses everything. Suppression happens **before** reporting, so a
suppressed hard signal cannot fail the check.

## 5. Reporting

Four independent surfaces, deliberately decoupled — losing one never breaks the others:

| Surface | Where | Notes |
| --- | --- | --- |
| Annotations | `::error` / `::warning` workflow commands | Inline on the diff. Needs `checks: write`. |
| Job summary | `$GITHUB_STEP_SUMMARY` | Markdown table, survives the PR. Write failures are ignored. |
| Sticky PR comment | `src/report/pr-comment.js` | One comment, updated in place. |
| Outputs | `$GITHUB_OUTPUT` | `findings`, `errors` for downstream steps. |

The comment reporter is strictly **best-effort**: it only acts inside a PR context with a
token, and any failure — missing env, network error, non-2xx — is swallowed and logged. It
can never break the Action. Stickiness comes from a hidden `<!-- veredicto -->` marker: the
reporter lists the PR's comments, finds the one carrying the marker, and PATCHes it instead
of posting a duplicate. It uses global `fetch`; there is no HTTP library.

## CI adapters — `src/ci/gitlab.js`

The GitLab adapter is split into a pure part (`resolveBaseRef(env)`, `buildDiffArgs(base)`)
and the one impure call that runs git. That is why it can be unit-tested with a simulated
environment and no repository. Adding another CI system means adding a module in the same
shape.

## Testing

```bash
node --test        # the whole suite, no dependencies
```

The suite covers each detector (positives **and** negatives — every rule has explicit
false-positive tests), the diff parser, the suppression logic, the reporters, the GitLab
adapter, a golden corpus of gamed and clean diffs in [`test/fixtures/`](../test/fixtures/),
and the documentation itself: [`test/rules-docs.test.js`](../test/rules-docs.test.js) fails
the build if a detector exists without a section in [RULES.md](RULES.md), or if RULES.md
documents a rule that does not exist. **The docs cannot silently drift from the code.**

## Why zero dependencies

This action runs on CI with access to private source code. Every dependency would be
something an auditor has to trust, and something a supply-chain attack could reach. Node
built-ins plus the `git` already on the runner are enough, so that is all it uses. Keep it
that way — a PR that adds a runtime dependency needs a very good argument.
