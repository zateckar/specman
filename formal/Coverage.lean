import Std
set_option autoImplicit false

namespace Specman.Coverage

structure Outcome where
  target : Nat
  succeeded : Bool
  deriving DecidableEq

def checked (outcomes : List Outcome) : List Outcome := outcomes.filter (·.succeeded)
def failed (outcomes : List Outcome) : List Outcome := outcomes.filter (fun o => !o.succeeded)

theorem coverage_partitions_attempts (outcomes : List Outcome) :
    (checked outcomes).length + (failed outcomes).length = outcomes.length := by
  induction outcomes with
  | nil => simp [checked, failed]
  | cons o rest ih =>
    cases success : o.succeeded <;> simp [checked, failed, success] at * <;> omega

theorem outcome_cannot_be_both (outcomes : List Outcome) (o : Outcome) :
    ¬ (o ∈ checked outcomes ∧ o ∈ failed outcomes) := by
  cases success : o.succeeded <;> simp [checked, failed, List.mem_filter, success]

def Clean (failures : Nat) (crossFailed : Bool) (input : Option Nat) (current findings : Nat) : Prop :=
  failures = 0 ∧ crossFailed = false ∧ input = some current ∧ findings = 0

theorem failure_prevents_clean {failures current findings : Nat} {input : Option Nat} {crossFailed : Bool}
    (h : failures > 0 ∨ crossFailed = true) : ¬ Clean failures crossFailed input current findings := by
  simp only [Clean]
  rcases h with h | h <;> simp_all <;> omega

theorem obsolete_input_prevents_clean {failures current findings : Nat} {input : Option Nat} {crossFailed : Bool}
    (stale : input ≠ some current) : ¬ Clean failures crossFailed input current findings := by
  simp [Clean, stale]

theorem unknown_input_prevents_clean (failures current findings : Nat) (crossFailed : Bool) :
    ¬ Clean failures crossFailed none current findings := by simp [Clean]

#print axioms coverage_partitions_attempts
#print axioms outcome_cannot_be_both
#print axioms failure_prevents_clean
#print axioms obsolete_input_prevents_clean
#print axioms unknown_input_prevents_clean
end Specman.Coverage
