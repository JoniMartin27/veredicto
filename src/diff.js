'use strict';

/**
 * Veredicto — unified-diff parser.
 *
 * Parses `git diff` unified output into per-file added/removed line records.
 * Pure, dependency-free. Shared by the detector registry and the entrypoint.
 *
 * @param {string} diff  Raw unified diff text (e.g. from `git diff --unified=0`).
 * @returns {Array<{ file: string, added: Array<{line:number, content:string}>, removed: Array<{content:string}> }>}
 *   One entry per changed file that has a resolvable path. `line` is the line
 *   number in the NEW file for each added line.
 */
function parseDiff(diff) {
  const files = [];
  let cur = null;
  let newLine = 0;
  for (const raw of String(diff).split('\n')) {
    if (raw.startsWith('diff --git')) {
      cur = { file: null, added: [], removed: [] };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4).trim();
      if (p !== '/dev/null') cur.file = p.replace(/^b\//, '');
      continue;
    }
    if (raw.startsWith('--- ')) {
      const p = raw.slice(4).trim();
      if (!cur.file && p !== '/dev/null') cur.file = p.replace(/^a\//, '');
      continue;
    }
    if (raw.startsWith('@@')) {
      const m = /\+(\d+)/.exec(raw);
      newLine = m ? parseInt(m[1], 10) : 0;
      continue;
    }
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      cur.added.push({ line: newLine, content: raw.slice(1) });
      newLine++;
    } else if (raw.startsWith('-') && !raw.startsWith('---')) {
      cur.removed.push({ content: raw.slice(1) });
    } else {
      newLine++;
    }
  }
  return files.filter((f) => f.file);
}

module.exports = { parseDiff };
