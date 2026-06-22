'use strict';

/**
 * Veredicto detector — relaxed-thresholds.
 *
 * Flags coverage / quality thresholds that are LOWERED inside config files.
 * Dropping a coverage gate (e.g. `branches: 90` → `branches: 70`) is a classic
 * way to make a failing build go green without actually adding tests, so a
 * decrease is reported as a hard error.
 *
 * We only look at config files (jest/vitest config, .nycrc, .c8rc, package.json,
 * sonar) and only at lines whose key is a known coverage/quality metric, then we
 * pair a removed line with an added line for the same key and compare the
 * numbers. A change is only flagged when the number strictly DECREASES — raising
 * a threshold, leaving it unchanged, or any non-numeric edit never fires.
 */

const CONFIG_RE =
  /(^|[\\/])(jest\.config\.[cm]?[jt]s|jest\.config\.json|vitest\.config\.[cm]?[jt]s|\.nycrc(\.json|\.yml|\.yaml)?|\.c8rc(\.json)?|package\.json|sonar-project\.properties|\.sonarcloud\.properties)$/i;

// Keys we treat as coverage / quality thresholds.
const KEYS =
  '(?:branches|functions|lines|statements|global|minCoverage|coverageThreshold)';

// Matches `key: 80`, `"key": 80`, `key = 80`, `key=80`, `key: 80.5`, `key: -1`.
const KEY_NUM_RE = new RegExp(
  '["\']?(' + KEYS + ')["\']?\\s*[:=]\\s*(-?\\d+(?:\\.\\d+)?)',
  'i'
);

function isConfigFile(file) {
  return CONFIG_RE.test(String(file));
}

/** Extract the first threshold key/value pair from a single line, or null. */
function extract(content) {
  const m = KEY_NUM_RE.exec(content);
  if (!m) return null;
  return { key: m[1].toLowerCase(), value: Number(m[2]) };
}

function detect(files) {
  const findings = [];
  for (const f of files) {
    if (!isConfigFile(f.file)) continue;

    // Map removed values by key. A key may appear multiple times (e.g. a
    // per-path coverageThreshold block); collect every removed value per key.
    const removedByKey = new Map();
    for (const r of f.removed) {
      const e = extract(r.content);
      if (!e || Number.isNaN(e.value)) continue;
      if (!removedByKey.has(e.key)) removedByKey.set(e.key, []);
      removedByKey.get(e.key).push(e.value);
    }
    if (removedByKey.size === 0) continue;

    for (const a of f.added) {
      const e = extract(a.content);
      if (!e || Number.isNaN(e.value)) continue;
      const candidates = removedByKey.get(e.key);
      if (!candidates || candidates.length === 0) continue;

      // Pair against the highest removed value for this key: if the new value
      // is below the previous best gate, the threshold was relaxed.
      const prevMax = Math.max(...candidates);
      if (e.value < prevMax) {
        findings.push({
          rule: 'relaxed-thresholds',
          severity: 'error',
          file: f.file,
          line: a.line || 1,
          message:
            'Coverage threshold "' +
            e.key +
            '" lowered ' +
            prevMax +
            '→' +
            e.value +
            ', which weakens the quality gate instead of adding tests.',
        });
      }
    }
  }
  return findings;
}

module.exports = { rule: 'relaxed-thresholds', detect };
