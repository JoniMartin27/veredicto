'use strict';

/**
 * Veredicto — GitHub Action entrypoint.
 *
 * Reads the pull-request diff, runs the static test-gaming detectors (loaded as
 * plugins from src/detectors/), applies inline suppressions, emits GitHub
 * annotations + a job summary, exposes outputs, and (in block mode) fails.
 * Zero dependencies: only Node built-ins + git already on the runner.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { analyze } = require('./registry');
const { parseDiff } = require('./diff');

function input(name, def) {
  const v = process.env['INPUT_' + name.toUpperCase().replace(/-/g, '_')];
  return v === undefined || v === '' ? def : v;
}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    return (e.stdout && e.stdout.toString()) || '';
  }
}

function getDiff() {
  // Optional GitLab CI source (best-effort; never fatal).
  if (process.env.GITLAB_CI) {
    try {
      const gl = require('./ci/gitlab');
      const d = gl && typeof gl.getDiff === 'function' ? gl.getDiff() : '';
      if (d && d.trim()) return d;
    } catch {
      /* no gitlab adapter or it failed — fall through to git */
    }
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  let base, head;
  if (eventPath && fs.existsSync(eventPath)) {
    try {
      const ev = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
      if (ev.pull_request) {
        base = ev.pull_request.base && ev.pull_request.base.sha;
        head = ev.pull_request.head && ev.pull_request.head.sha;
      }
    } catch {
      /* ignore */
    }
  }
  if (base && head) {
    // Ensure both commits are present (checkout may be shallow).
    git(['fetch', '--no-tags', '--depth=1', 'origin', base, head]);
    const d = git(['diff', '--unified=0', `${base}..${head}`]);
    if (d.trim()) return d;
  }
  // Fallback: last commit.
  return git(['diff', '--unified=0', 'HEAD~1..HEAD']);
}

/**
 * Drop findings suppressed by an inline comment on the line directly above.
 * Recognized (in any added line whose content includes the directive):
 *   veredicto-disable-next-line <rule>   → suppress <rule> on the next line
 *   veredicto-disable <rule>             → suppress <rule> on the next line
 *   ... with no <rule>                   → suppress ALL rules on the next line
 * Suppression keys off (file, line, rule) using the diff's added lines.
 */
function applySuppressions(findings, diff) {
  const files = parseDiff(diff);
  // Map: file -> (suppressedLine -> Set<rule> | '*')
  const suppress = new Map();
  const DIRECTIVE = /veredicto-disable(?:-next-line)?(?:\s+([a-z0-9-]+))?/i;
  for (const f of files) {
    for (const a of f.added) {
      const m = DIRECTIVE.exec(a.content);
      if (!m) continue;
      const target = a.line + 1; // applies to the next line in the new file
      let perFile = suppress.get(f.file);
      if (!perFile) {
        perFile = new Map();
        suppress.set(f.file, perFile);
      }
      const existing = perFile.get(target);
      if (m[1]) {
        if (existing === '*') continue;
        const set = existing instanceof Set ? existing : new Set();
        set.add(m[1].toLowerCase());
        perFile.set(target, set);
      } else {
        perFile.set(target, '*'); // bare directive suppresses everything
      }
    }
  }
  if (!suppress.size) return findings;
  return findings.filter((f) => {
    const perFile = suppress.get(f.file);
    if (!perFile) return true;
    const rules = perFile.get(f.line);
    if (!rules) return true;
    if (rules === '*') return false;
    return !rules.has(String(f.rule).toLowerCase());
  });
}

function annotate(f) {
  const kind = f.severity === 'error' ? 'error' : 'warning';
  const safe = (s) => String(s).replace(/\r?\n/g, ' ');
  console.log(`::${kind} file=${f.file},line=${f.line},title=Veredicto: ${f.rule}::${safe(f.message)}`);
}

function summary(findings) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  const lines = ['# ⚖️ Veredicto', ''];
  if (!findings.length) {
    lines.push('✅ **No test-gaming signals detected** in this diff.');
  } else {
    lines.push(`Found **${findings.length}** signal(s) of test-gaming:`, '', '| Rule | File | Line | Detail |', '| --- | --- | --- | --- |');
    for (const f of findings) {
      lines.push(`| \`${f.rule}\` | \`${f.file}\` | ${f.line} | ${f.message.replace(/\|/g, '\\|')} |`);
    }
    lines.push('', '_Free static detection. The diff-vs-claim LLM judge + signed report is the Pro tier → https://fervon.dev/veredicto/_');
  }
  try {
    fs.appendFileSync(path, lines.join('\n') + '\n');
  } catch {
    /* ignore */
  }
}

function main() {
  const mode = (input('mode', 'warn') || 'warn').toLowerCase();
  const diff = getDiff();
  if (!diff.trim()) {
    console.log('Veredicto: empty diff, nothing to analyze.');
    return;
  }
  let findings = analyze(diff);
  findings = applySuppressions(findings, diff);

  for (const f of findings) annotate(f);
  summary(findings);

  // Best-effort PR comment (only if the optional reporter is present).
  try {
    const reporter = require('./report/pr-comment');
    if (reporter && typeof reporter.post === 'function') reporter.post(findings);
  } catch {
    /* no reporter module, or it failed — never fatal */
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  console.log(`Veredicto: ${findings.length} signal(s) (${errors} hard, ${findings.length - errors} soft).`);

  // Expose outputs.
  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    try {
      fs.appendFileSync(out, `findings=${findings.length}\nerrors=${errors}\n`);
    } catch {
      /* ignore */
    }
  }

  if (mode === 'block' && errors > 0) {
    console.log(`::error::Veredicto blocked the PR: ${errors} hard test-gaming signal(s). Set mode: warn to make this non-blocking.`);
    process.exit(1);
  }
}

main();
