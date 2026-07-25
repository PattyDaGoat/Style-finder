#!/usr/bin/env node
/**
 * run-all.mjs — build, then run every suite and summarise.
 *
 * Any agent touching this project runs this before committing. It is the whole
 * reason the app can be changed by more than one person without fear.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);

console.log('building…');
execFileSync('node', [join(REPO, 'build.mjs')], { stdio: 'inherit' });

const suites = readdirSync(HERE).filter(f => /^\d\d-.*\.js$/.test(f)).sort();
let pass = 0, fail = 0, broken = [];
for (const s of suites) {
  process.stdout.write(`\n── ${s} `.padEnd(60, '─') + '\n');
  const r = spawnSync('node', [join(HERE, s)], { encoding: 'utf8', timeout: 15 * 60 * 1000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const p = (out.match(/===== PASS \((\d+)\)/) || [])[1];
  const f = (out.match(/===== FAIL \((\d+)\)/) || [])[1];
  if (p) pass += +p;
  if (f) { fail += +f; broken.push(s); }
  if (!p && !f) { broken.push(s + ' (did not report)'); fail += 1; }
  console.log(`   ${p || 0} passed${f ? `, ${f} FAILED` : ''}`);
  if (f) out.split('\n').filter(l => l.includes('FAIL ')).forEach(l => console.log('   ' + l.trim()));
}
console.log('\n' + '═'.repeat(60));
console.log(`${pass} assertions passed, ${fail} failed across ${suites.length} suites`);
if (broken.length) { console.log('problems in: ' + broken.join(', ')); process.exit(1); }
console.log('ALL GREEN');
