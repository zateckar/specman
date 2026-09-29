/** Kernel-check the protocol models; no generated files or extra packages. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const lean = process.env.LEAN ?? 'lean';
const toolchain = readFileSync(new URL('../formal/lean-toolchain', import.meta.url), 'utf8').trim();
const version = toolchain.replace('leanprover/lean4:v', '');
const env = { ...process.env };
// Some Windows launchers omit ELAN_HOME even though the shims are on PATH.
if (!env.ELAN_HOME && existsSync(join(homedir(), '.elan'))) env.ELAN_HOME = join(homedir(), '.elan');
const allowedAxioms = new Set(['propext', 'Classical.choice', 'Quot.sound']);
const proofs = {
  'formal/Lock.lean': ['old_timeout_allows_overlap', 'ownership_consistent', 'never_overlaps'],
  'formal/Approval.lean': ['valid_review_matches', 'history_matches', 'approved_revision_is_reviewed',
    'changed_head_rejected', 'changed_base_rejected', 'replaced_proposal_rejected', 'old_approval_can_merge_unreviewed'],
  'formal/OptimisticUpdate.lean': ['accepted_history_is_current', 'revision_never_decreases', 'trace_revision_never_decreases',
    'same_snapshot_cannot_win_again', 'stale_snapshot_rejected', 'old_write_can_accept_a_stale_snapshot'],
  'formal/Recovery.lean': ['closure_requires_authorized_merge', 'recovery_follows_protocol', 'recovery_uses_durable_authorization',
    'successful_recovery_completes', 'recovery_is_idempotent', 'recovery_never_invents_authorization', 'blocked_recovery_preserves_state', 'merge_can_outlive_its_database_marker'],
  'formal/Completion.lean': ['pending_assumptions_block_completion', 'questions_block_completion',
    'complete_iff_no_open_work', 'confirming_last_assumption_restores_verdict'],
  'formal/Coverage.lean': ['coverage_partitions_attempts', 'outcome_cannot_be_both', 'failure_prevents_clean',
    'obsolete_input_prevents_clean', 'unknown_input_prevents_clean'],
  'formal/Identity.lean': ['name_collision_cannot_adopt_account', 'new_identity_is_not_admin',
    'linked_identity_ignores_username', 'registration_preserves_existing_links', 'registration_links_only_ordinary_user']
};

function run(args) {
  const result = spawnSync(lean, args, { cwd: root, env, encoding: 'utf8', timeout: 60_000 });
  if (result.error || result.status !== 0) {
    throw new Error(`Lean check failed: ${result.error?.message ?? result.stderr + result.stdout}`);
  }
  return result.stdout;
}

try {
  if (run(['--short-version']).trim() !== version) throw new Error(`Expected Lean ${version}; set LEAN to its executable.`);
  for (const [file, names] of Object.entries(proofs)) {
    const output = run(['-DwarningAsError=true', file]);
    // Audit every required theorem, not just successful elaboration. A custom
    // axiom (including sorryAx or native_decide's trusted escape) is rejected.
    for (const name of names) {
      const report = output.split(/\r?\n/).find(line => line.includes(`.${name}'`));
      if (!report) throw new Error(`${file}: missing axiom audit for ${name}`);
      if (!report.includes('does not depend on any axioms')) {
        const match = report.match(/depends on axioms: \[([^\]]*)\]/);
        if (!match || match[1].split(',').map(x => x.trim()).some(x => !allowedAxioms.has(x))) {
          throw new Error(`${file}: untrusted proof dependencies: ${report}`);
        }
      }
    }
    console.log(`PASS  ${file}: ${names.length} audited theorems (Lean ${version})`);
  }
} catch (cause) {
  console.error(cause.message);
  process.exitCode = 1;
}
