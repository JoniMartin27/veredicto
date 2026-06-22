'use strict';

/**
 * Veredicto detector — circular-mocks.
 *
 * Flags a test that mocks the very module it is supposed to be testing and
 * then asserts on that mock. This is a "test-gaming" pattern: the test no
 * longer exercises the real implementation, so it passes regardless of whether
 * the code under test is correct — the assertions only verify the mock the
 * author wrote.
 *
 *   warning — the test file mocks the module under test:
 *               jest.mock("./foo")  / vi.mock("../foo")            in foo.test.js
 *               from foo import ...; patch("foo.bar")              in test_foo.py
 *             AND the body later asserts on that mock (expect(mock...),
 *             mock.assert_called..., toHaveBeenCalled, etc.).
 *
 * Conservative by design — two independent signals must BOTH appear in the
 * diff for the same test file before anything fires:
 *   1. a mock whose target basename equals the module under test, and
 *   2. an assertion that references a mock.
 * Mocking a *dependency* (a different module) never fires, and mocking the
 * module under test without asserting on the mock never fires.
 */

const RULE = 'circular-mocks';

// Recognise a test file and recover the basename of the module under test.
// foo.test.js -> "foo", components/Bar.spec.tsx -> "bar", test_baz.py -> "baz".
function moduleUnderTest(file) {
  const base = String(file).replace(/\\/g, '/').split('/').pop() || '';

  // JS/TS: <name>.(test|spec).<ext>
  let m = /^(.+?)[._-](?:test|spec)\.[cm]?[jt]sx?$/i.exec(base);
  if (m) return m[1].toLowerCase();

  // Python: test_<name>.py  or  <name>_test.py
  m = /^test_(.+)\.py$/i.exec(base);
  if (m) return m[1].toLowerCase();
  m = /^(.+)_test\.py$/i.exec(base);
  if (m) return m[1].toLowerCase();

  return null;
}

// jest.mock("X") / vi.mock('X') / jest.doMock("X")  — capture the quoted target.
const JS_MOCK_RE =
  /\b(?:jest|vi)\s*\.\s*(?:do)?[mM]ock\s*\(\s*(?:"([^"\n]+)"|'([^'\n]+)'|`([^`\n]+)`)/;

// Python: patch("X") / patch.object(X, ...) — capture the quoted dotted path.
const PY_PATCH_RE =
  /\bpatch\s*(?:\.object)?\s*\(\s*(?:"([^"\n]+)"|'([^'\n]+)')/;

// An assertion that targets a mock (rather than real output).
const ASSERT_ON_MOCK_RE =
  /toHaveBeenCalled|toBeCalled|expect\s*\(\s*\w*[mM]ock|\.assert_called|\.assert_any_call|\.assert_not_called|\.called_with|\.mock\.calls/;

// Candidate basenames for a module specifier (lower-cased).
// JS: "./foo" -> ["foo"], "../utils/foo.js" -> ["foo"].
// Python: "baz.compute" -> ["baz", "compute"] (the module part is "baz", but a
// patch can target either the module or a symbol inside it, so we consider
// every dotted segment — a match on any means the test patches its own module).
function targetBasenames(spec) {
  const s = String(spec).replace(/\\/g, '/');
  // Python dotted module path (no slash, no JS extension): all dotted segments.
  if (!s.includes('/') && s.includes('.') && !/\.[cm]?[jt]sx?$/i.test(s)) {
    return s.split('.').map((x) => x.toLowerCase());
  }
  const base = s.split('/').pop().replace(/\.[cm]?[jt]sx?$/i, '');
  return [base.toLowerCase()];
}

function mockTargetFrom(content) {
  let m = JS_MOCK_RE.exec(content);
  if (m) return m[1] || m[2] || m[3];
  m = PY_PATCH_RE.exec(content);
  if (m) return m[1] || m[2];
  return null;
}

function isComment(s) {
  const t = s.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('#');
}

function detect(files) {
  const findings = [];
  for (const f of files) {
    const mut = moduleUnderTest(f.file);
    if (!mut) continue;

    let selfMock = null; // first added line that mocks the module under test
    let assertsOnMock = false;

    for (const a of f.added) {
      const content = a.content;
      if (isComment(content)) continue;

      if (!selfMock) {
        const target = mockTargetFrom(content);
        if (target && targetBasenames(target).includes(mut)) {
          selfMock = a;
        }
      }
      if (ASSERT_ON_MOCK_RE.test(content)) {
        assertsOnMock = true;
      }
    }

    if (selfMock && assertsOnMock) {
      findings.push({
        rule: RULE,
        severity: 'warning',
        file: f.file,
        line: selfMock.line,
        message:
          'Circular mock: the test mocks the module under test and then asserts on that mock, so the real implementation is never exercised.',
      });
    }
  }
  return findings;
}

module.exports = { rule: RULE, detect };
