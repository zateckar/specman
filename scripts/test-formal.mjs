/** Ensure the publication proof gate rejects invalid evidence. Requires Lean. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'specman-formal-'));
assert.equal(dirname(resolve(root)), resolve(tmpdir()));
mkdirSync(join(root, 'scripts'));
mkdirSync(join(root, 'formal'));
copyFileSync(new URL('./check-formal.mjs', import.meta.url), join(root, 'scripts/check-formal.mjs'));
const original = Object.fromEntries(['Lock.lean', 'Approval.lean', 'OptimisticUpdate.lean',
  'Recovery.lean', 'Completion.lean', 'Coverage.lean', 'Identity.lean', 'lean-toolchain'].map(file =>
  [file, readFileSync(new URL(`../formal/${file}`, import.meta.url), 'utf8')]));

function rejects(name, change, expected) {
  for (const [file, source] of Object.entries(original)) writeFileSync(join(root, 'formal', file), source);
  change();
  const result = spawnSync(process.execPath, [join(root, 'scripts/check-formal.mjs')], {
    encoding: 'utf8', timeout: 60_000
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1, name);
  assert.match(result.stderr, expected, name);
  console.log(`PASS  proof gate rejects ${name}`);
}

try {
  rejects('incomplete proofs', () => {
    writeFileSync(join(root, 'formal/Lock.lean'), original['Lock.lean'] + '\nexample : False := by sorry\n');
  }, /sorry|declaration uses/);
  rejects('custom axiom dependencies', () => {
    const source = original['Lock.lean'].replace(
      /theorem never_overlaps[\s\S]*?(?=\n#print axioms)/,
      'axiom fabricated : False\ntheorem never_overlaps {s : State} (_h : Reachable s) : s.active ≤ 1 := fabricated.elim\n'
    );
    assert.notEqual(source, original['Lock.lean']);
    writeFileSync(join(root, 'formal/Lock.lean'), source);
  }, /untrusted proof dependencies.*fabricated/);
  rejects('missing theorem audits', () => {
    writeFileSync(join(root, 'formal/Lock.lean'), original['Lock.lean'].replace('#print axioms never_overlaps', ''));
  }, /missing axiom audit for never_overlaps/);
  rejects('a compiler version different from the pin', () => {
    writeFileSync(join(root, 'formal/lean-toolchain'), 'leanprover/lean4:v0.0.0\n');
  }, /Expected Lean 0.0.0/);
} finally {
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  rmSync(root, { recursive: true, force: true });
}
