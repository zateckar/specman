import Std

set_option autoImplicit false

namespace Specman.Lock

/-- One arbitrary repository key; independent keys have independent states. -/
structure State where
  held : Bool
  active : Nat
  deriving DecidableEq, Repr

/-- The old protocol released ownership when only the caller timed out. -/
inductive OldStep : State → State → Prop where
  | start (n : Nat) : OldStep ⟨false, n⟩ ⟨true, n + 1⟩
  | timeout (n : Nat) : OldStep ⟨true, n⟩ ⟨false, n⟩

inductive OldReachable : State → Prop where
  | initial : OldReachable ⟨false, 0⟩
  | next {a b : State} : OldReachable a → OldStep a b → OldReachable b

theorem old_timeout_allows_overlap :
    ∃ s, OldReachable s ∧ s.active > 1 := by
  refine ⟨⟨true, 2⟩, ?_, by decide⟩
  exact .next (.next (.next .initial (.start 0)) (.timeout 1)) (.start 1)

/-- Queue handoff waits for actual work settlement, including rejection. -/
inductive Step : State → State → Prop where
  | start (n : Nat) : Step ⟨false, n⟩ ⟨true, n + 1⟩
  | timeout (s : State) : Step s s
  | settle (n : Nat) : Step ⟨true, n + 1⟩ ⟨false, n⟩

inductive Reachable : State → Prop where
  | initial : Reachable ⟨false, 0⟩
  | next {a b : State} : Reachable a → Step a b → Reachable b

def OwnershipConsistent (s : State) : Prop :=
  if s.held then s.active = 1 else s.active = 0

theorem ownership_consistent {s : State} (h : Reachable s) :
    OwnershipConsistent s := by
  induction h with
  | initial => simp [OwnershipConsistent]
  | next _ transition ih =>
    cases transition with
    | start n =>
      have hn : n = 0 := by simpa [OwnershipConsistent] using ih
      simp [OwnershipConsistent, hn]
    | timeout => exact ih
    | settle n =>
      have hn : n + 1 = 1 := by simpa [OwnershipConsistent] using ih
      have hz : n = 0 := by omega
      simp [OwnershipConsistent, hz]

/-- Safety for every finite execution, without assuming termination. -/
theorem never_overlaps {s : State} (h : Reachable s) : s.active ≤ 1 := by
  have consistent := ownership_consistent h
  cases held : s.held <;> simp [OwnershipConsistent, held] at consistent <;> omega

#print axioms old_timeout_allows_overlap
#print axioms ownership_consistent
#print axioms never_overlaps

end Specman.Lock
