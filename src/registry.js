'use strict';

/**
 * Veredicto — detector registry (plugin loader).
 *
 * Auto-loads every `src/detectors/*.js` module, runs each against the parsed
 * diff, and concatenates their findings. Drop a new file in `src/detectors/`
 * and it is picked up automatically — no wiring needed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  DETECTOR CONTRACT  (each file in src/detectors/<rule>.js MUST export this)
 * ─────────────────────────────────────────────────────────────────────────────
 *   module.exports = {
 *     rule: 'kebab-case-name',          // unique, stable id for the rule
 *     detect(files) {                   // files = output of parseDiff(diff)
 *       return findings;                // Array<Finding>
 *     }
 *   }
 *
 *   files: Array<{
 *     file: string,                                  // path in the new tree
 *     added: Array<{ line: number, content: string }>,   // added lines (+)
 *     removed: Array<{ content: string }>                // removed lines (-)
 *   }>
 *
 *   Finding: {
 *     rule: string,                       // same kebab id as `rule`
 *     severity: 'error' | 'warning',      // error = hard signal (can block);
 *                                         // warning = soft signal
 *     file: string,                       // file the finding refers to
 *     line: number,                       // line in the NEW file (use a.line
 *                                         // from the matching added line, or 1)
 *     message: string                     // one English sentence: why this is
 *                                         // test-gaming
 *   }
 *
 *  RULES FOR DETECTOR AUTHORS:
 *   - Be conservative: a false positive (flagging legit code) is worse than a
 *     miss. Your rule must NOT fire on ordinary, honest changes.
 *   - Pure & synchronous: no I/O, no network, no global state, no throwing.
 *   - Only read from `files`; never touch the filesystem or process env.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseDiff } = require('./diff');

const DETECTORS_DIR = path.join(__dirname, 'detectors');

/**
 * Load all detector plugins from a directory (src/detectors/ by default).
 * Tolerates a missing or empty directory.
 *
 * `dir` is a parameter so tests can load a plugin from a temporary directory
 * instead of writing into the shipped `src/detectors/`. Writing there is a real
 * hazard, not a style preference: `node --test` runs test files in PARALLEL
 * PROCESSES and this function re-reads the directory on every call, so a test
 * that drops a file in it can make another test process either pick up a ghost
 * detector or blow up with ENOENT on a file that was just unlinked.
 *
 * @param {string} [dir]  Directory to load detectors from.
 */
function loadDetectors(dir = DETECTORS_DIR) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const detectors = [];
  for (const name of entries) {
    if (!name.endsWith('.js')) continue;
    let mod;
    try {
      mod = require(path.join(dir, name));
    } catch {
      continue; // unreadable or vanished mid-read — never take the whole run down
    }
    if (mod && typeof mod.detect === 'function') detectors.push(mod);
  }
  return detectors;
}

/**
 * Parse a raw diff and run every registered detector against it.
 * @param {string} diff  Raw unified diff text.
 * @param {string} [dir]  Detector directory; defaults to src/detectors/.
 * @returns {Array<Finding>}  Concatenated findings from all detectors.
 */
function analyze(diff, dir) {
  const files = parseDiff(diff);
  const detectors = loadDetectors(dir);
  const findings = [];
  for (const d of detectors) {
    const out = d.detect(files);
    if (Array.isArray(out)) findings.push(...out);
  }
  return findings;
}

module.exports = { analyze, loadDetectors };
