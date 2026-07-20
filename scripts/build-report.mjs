// Builds test-report.js from the Vitest JSON output + V8 coverage summary.
// Emitted as an assigning script (window.__TEST_REPORT__ = ...) so the
// dashboard works from file:// without fetch().
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { SCENARIO_META } from '../test/scenario/meta.js';

const vitestJson = JSON.parse(readFileSync('.vitest-report.json', 'utf8'));

let coverage = null;
if (existsSync('coverage/coverage-summary.json')) {
  const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
  const pct = (entries) => {
    const sum = entries.reduce((a, e) => ({ covered: a.covered + e.lines.covered, total: a.total + e.lines.total }), { covered: 0, total: 0 });
    return sum.total ? Math.round((sum.covered / sum.total) * 1000) / 10 : 0;
  };
  const files = Object.entries(summary).filter(([k]) => k !== 'total');
  const inDir = (dir) => files.filter(([k]) => k.includes(`/src/${dir}/`)).map(([, v]) => v);
  coverage = {
    total: summary.total.lines.pct,
    engine: pct(inDir('engine')),
    rules: pct(inDir('rules')),
    data: pct(inDir('data')),
  };
}

const suiteOf = (file) => {
  const m = file.match(/test\/(\w+)\//);
  return m ? m[1] : 'root';
};

const suitesMap = {};
let pass = 0, fail = 0, skip = 0;
for (const tf of vitestJson.testResults) {
  const suite = suiteOf(tf.name);
  suitesMap[suite] ??= { name: suite, tests: [] };
  for (const t of tf.assertionResults) {
    const idMatch = t.title.match(/^(T\d{2})/);
    const id = idMatch ? idMatch[1] : null;
    const meta = id ? SCENARIO_META[id] : null;
    const status = t.status === 'passed' ? 'pass' : t.status === 'failed' ? 'fail' : 'skip';
    if (status === 'pass') pass++; else if (status === 'fail') fail++; else skip++;
    suitesMap[suite].tests.push({
      id: id ?? t.title,
      title: t.title,
      status,
      durationMs: Math.round(t.duration ?? 0),
      anchor: meta?.anchor,
      evidenceLevel: meta?.evidenceLevel,
      rules: meta?.rules,
    });
  }
}

const order = ['data', 'engine', 'rules', 'scenario'];
const suites = Object.values(suitesMap).sort((a, b) => {
  const ia = order.indexOf(a.name); const ib = order.indexOf(b.name);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
});

const report = {
  generatedAt: new Date().toISOString(),
  totals: { pass, fail, skip, total: pass + fail + skip },
  coverage,
  suites,
};

writeFileSync('test-report.js', 'window.__TEST_REPORT__ = ' + JSON.stringify(report, null, 2) + ';\n');
console.log(`test-report.js written: ${pass} pass, ${fail} fail, ${skip} skip` + (coverage ? `, coverage total ${coverage.total}% (engine ${coverage.engine}%, rules ${coverage.rules}%)` : ''));
