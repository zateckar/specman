import Std
set_option autoImplicit false

namespace Specman.OptimisticUpdate

structure Write where
  expected : Nat
  observed : Nat
  resulting : Nat
  deriving DecidableEq

structure State where
  revision : Nat
  accepted : List Write
  deriving DecidableEq

inductive Step : State → State → Prop where
  | external (s : State) (next : Nat) : s.revision < next →
      Step s { s with revision := next }
  | accept (s : State) (expected next : Nat) : expected = s.revision → s.revision < next →
      Step s ⟨next, ⟨expected, s.revision, next⟩ :: s.accepted⟩
  | rejectOrRollback (s : State) : Step s s

inductive Reachable : State → Prop where
  | initial : Reachable ⟨0, []⟩
  | next {a b : State} : Reachable a → Step a b → Reachable b

def ValidHistory (s : State) : Prop :=
  ∀ w ∈ s.accepted, w.expected = w.observed ∧ w.observed < w.resulting

theorem accepted_history_is_current {s : State} (h : Reachable s) : ValidHistory s := by
  induction h with
  | initial => simp [ValidHistory]
  | next _ step ih =>
    cases step with
    | external => exact ih
    | rejectOrRollback => exact ih
    | accept expected next equal greater =>
      intro w member
      simp only [List.mem_cons] at member
      rcases member with same | old
      · subst w; exact ⟨equal, greater⟩
      · exact ih w old

theorem revision_never_decreases {a b : State} (h : Step a b) : a.revision ≤ b.revision := by
  cases h <;> simp_all <;> omega

inductive From (start : State) : State → Prop where
  | initial : From start start
  | next {a b : State} : From start a → Step a b → From start b

theorem trace_revision_never_decreases {a b : State} (h : From a b) : a.revision ≤ b.revision := by
  induction h with
  | initial => exact Nat.le_refl _
  | next _ step ih => exact Nat.le_trans ih (revision_never_decreases step)

theorem same_snapshot_cannot_win_again {expected : Nat} {after later : State}
    (greater : expected < after.revision) (trace : From after later) :
    expected ≠ later.revision := by
  have monotone := trace_revision_never_decreases trace
  omega

theorem stale_snapshot_rejected {s : State} {expected : Nat}
    (stale : expected ≠ s.revision) : ¬ expected = s.revision := stale

/-- Old writes accepted the original snapshot even after another writer advanced it. -/
inductive OldStep : State → State → Prop where
  | accept (s : State) (expected : Nat) :
      OldStep s ⟨s.revision + 1, ⟨expected, s.revision, s.revision + 1⟩ :: s.accepted⟩

inductive OldReachable : State → Prop where
  | initial : OldReachable ⟨0, []⟩
  | next {a b : State} : OldReachable a → OldStep a b → OldReachable b

theorem old_write_can_accept_a_stale_snapshot :
    ∃ s : State, OldReachable s ∧ ¬ ValidHistory s := by
  refine ⟨⟨2, [⟨0, 1, 2⟩, ⟨0, 0, 1⟩]⟩, ?_, ?_⟩
  · exact .next (.next .initial (.accept ⟨0, []⟩ 0)) (.accept ⟨1, [⟨0, 0, 1⟩]⟩ 0)
  · simp [ValidHistory]

#print axioms accepted_history_is_current
#print axioms revision_never_decreases
#print axioms trace_revision_never_decreases
#print axioms same_snapshot_cannot_win_again
#print axioms stale_snapshot_rejected
#print axioms old_write_can_accept_a_stale_snapshot
end Specman.OptimisticUpdate
