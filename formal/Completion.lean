import Std
set_option autoImplicit false

namespace Specman.Completion

inductive Status where
  | empty | inProgress | complete
  deriving DecidableEq

def reconcile (raw : Status) (questions : Nat) : Status :=
  if raw = .complete ∧ questions > 0 then .inProgress else raw

def effective (stored : Status) (pending : Nat) : Status :=
  if stored = .complete ∧ pending > 0 then .inProgress else stored

def display (raw : Status) (questions pending : Nat) : Status :=
  effective (reconcile raw questions) pending

theorem pending_assumptions_block_completion (raw : Status) {pending : Nat} (h : pending > 0) :
    effective raw pending ≠ .complete := by
  cases raw <;> simp [effective, h]

theorem questions_block_completion (raw : Status) {questions : Nat} (h : questions > 0) :
    reconcile raw questions ≠ .complete := by
  cases raw <;> simp [reconcile, h]

theorem complete_iff_no_open_work (raw : Status) (questions pending : Nat) :
    display raw questions pending = .complete ↔ raw = .complete ∧ questions = 0 ∧ pending = 0 := by
  cases raw <;> simp [display, reconcile, effective]
  by_cases q : questions > 0 <;> by_cases p : pending > 0 <;> simp_all <;> omega

theorem confirming_last_assumption_restores_verdict (stored : Status) :
    effective stored 0 = stored := by simp [effective]

#print axioms pending_assumptions_block_completion
#print axioms questions_block_completion
#print axioms complete_iff_no_open_work
#print axioms confirming_last_assumption_restores_verdict
end Specman.Completion
