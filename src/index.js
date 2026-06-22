'use strict';

/**
 * Veredicto — GitHub Action entrypoint.
 *
 * Reads the pull-request diff, runs the static test-gaming detectors, emits
 * GitHub annotations + a job summary, and (in block mode) fails the check.
 * Zero dependencies: only Node built-ins + git already on the runner.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { analyze } = require('./detectors');

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
  const findings = analyze(diff);

  for (const f of findings) annotate(f);
  summary(findings);

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
