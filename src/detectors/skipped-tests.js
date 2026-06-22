'use strict';

/**
 * Veredicto detector — skipped-tests.
 *
 * Flags ADDED lines that silence or narrow a test suite instead of fixing it:
 *   - JS/TS:   it.skip / test.skip / describe.skip
 *              it.todo / test.todo / describe.todo
 *              xit / xdescribe / xtest / xspecify
 *              it.only / test.only / describe.only  (narrowing the run)
 *   - Python:  @pytest.mark.skip / @pytest.mark.skipif / @pytest.mark.xfail
 *              @unittest.skip / @unittest.skipIf / @unittest.skipUnless /
 *              @unittest.expectedFailure
 *
 * Each match is a `warning` (soft signal): silencing a test is a common way to
 * make a red suite go green without addressing the failure.
 *
 * Conservative by design — matches only deliberate skip/only/todo markers on
 * added lines, so ordinary calls like `it('works', ...)` never fire.
 */

/**
 * Ordered list of skip/only/todo signatures. Each entry maps a regex (tested
 * against a single added line) to the human-readable mechanism reported in the
 * message. Patterns require an opening `(` or `:`/end so identifiers like
 * `monitor.skipped` or `describeThing()` don't trip them.
 */
const SIGNATURES = [
  // JS/TS: it.only / test.only / describe.only (run-narrowing)
  { re: /\b(?:it|test|describe|context|suite|specify)\s*\.\s*only\s*\(/, mech: '.only' },
  // JS/TS: it.skip / test.skip / describe.skip
  { re: /\b(?:it|test|describe|context|suite|specify)\s*\.\s*skip\s*\(/, mech: '.skip' },
  // JS/TS: it.todo / test.todo / describe.todo
  { re: /\b(?:it|test|describe|context|suite|specify)\s*\.\s*todo\s*\(/, mech: '.todo' },
  // JS/TS: xit / xdescribe / xtest / xspecify  (Jasmine/Jest disabled specs)
  { re: /\b(?:xit|xdescribe|xtest|xspecify)\s*\(/, mech: 'x-prefixed disabled spec' },
  // Python (pytest): @pytest.mark.skip / .skipif / .xfail
  { re: /@\s*pytest\s*\.\s*mark\s*\.\s*(?:skip|skipif|xfail)\b/, mech: 'pytest skip/xfail mark' },
  // Python (unittest): @unittest.skip / .skipIf / .skipUnless / .expectedFailure
  { re: /@\s*unittest\s*\.\s*(?:skip|skipIf|skipUnless|expectedFailure)\b/, mech: 'unittest skip mark' },
  // Python (unittest): bare @skip / @skipIf / @skipUnless / @expectedFailure imports
  { re: /@\s*(?:skip|skipIf|skipUnless|skipUnlessDBFeature|expectedFailure)\b/, mech: 'unittest skip mark' },
];

module.exports = {
  rule: 'skipped-tests',
  /**
   * @param {Array<{file:string, added:Array<{line:number,content:string}>}>} files
   * @returns {Array<{rule:string,severity:string,file:string,line:number,message:string}>}
   */
  detect(files) {
    const findings = [];
    if (!Array.isArray(files)) return findings;
    for (const f of files) {
      if (!f || !Array.isArray(f.added)) continue;
      for (const a of f.added) {
        const content = a && typeof a.content === 'string' ? a.content : '';
        if (!content) continue;
        for (const sig of SIGNATURES) {
          if (sig.re.test(content)) {
            findings.push({
              rule: 'skipped-tests',
              severity: 'warning',
              file: f.file,
              line: a.line || 1,
              message: `Test silenced via ${sig.mech}, which hides failures instead of fixing them.`,
            });
            break; // one finding per added line
          }
        }
      }
    }
    return findings;
  },
};
