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

// process.execPath, not 'node': spawning by bare name searches PATH, and there
// is no guarantee the interpreter running this file is on it. On a machine with
// no system-wide Node — only an unzipped portable copy — every suite died with
// `spawnSync node ENOENT` before a single assertion ran. Re-using the running
// interpreter also guarantees the suites run on the same version as the runner.
console.log('building…');
execFileSync(process.execPath, [join(REPO, 'build.mjs')], { stdio: 'inherit' });

const suites = readdirSync(HERE).filter(f => /^\d\d-.*\.js$/.test(f)).sort();
let pass = 0, fail = 0, broken = [];
for (const s of suites) {
  process.stdout.write(`\n── ${s} `.padEnd(60, '─') + '\n');
  const r = spawnSync(process.execPath, [join(HERE, s)], { encoding: 'utf8', timeout: 15 * 60 * 1000 });
  const out = (r.stdout || '') + (r.stderr || '');
  // A suite that could not be launched at all used to be reported as
  // "(did not report)", which reads exactly like a suite that ran and printed
  // nothing — so a missing interpreter looked like a broken test. Say which.
  if (r.error) console.log(`   could not run this suite: ${r.error.code} — ${r.error.message}`);
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
