import Std

set_option autoImplicit false

namespace Specman.Approval

/-- Commit identifiers are abstract atoms; only equality matters. -/
structure Revision where
  proposalId : Nat
  head : Nat
  base : Nat
  deriving DecidableEq, Repr

structure State where
  current : Revision
  isOpen : Bool
  accepted : List (Revision × Revision)
  deriving DecidableEq, Repr

def initial : State := ⟨⟨1, 0, 0⟩, true, []⟩

def ValidReview (s : State) (reviewed : Revision) : Prop :=
  s.isOpen = true ∧ reviewed.proposalId = s.current.proposalId ∧
  reviewed.head = s.current.head ∧ reviewed.base = s.current.base

theorem valid_review_matches {s : State} {r : Revision} (h : ValidReview s r) :
    r = s.current := by
  cases s with
  | mk current isOpen accepted =>
    cases current
    cases r
    simp_all [ValidReview]

/-- This transition is the critical section: validation and merge share ownership.
    The second recorded token denotes the revision actually consumed by the merge. -/
inductive Step : State → State → Prop where
  | edit (s : State) (head : Nat) :
      Step s { s with current := { s.current with head := head } }
  | base (s : State) (base : Nat) :
      Step s { s with current := { s.current with base := base } }
  | replace (s : State) (revision : Revision) :
      Step s { s with current := revision, isOpen := true }
  | approve (s : State) (r : Revision) : ValidReview s r →
      Step s { s with isOpen := false, accepted := (r, s.current) :: s.accepted }

inductive Reachable : State → Prop where
  | initial : Reachable initial
  | next {a b : State} : Reachable a → Step a b → Reachable b

def HistoryMatches (s : State) : Prop :=
  ∀ pair ∈ s.accepted, pair.1 = pair.2

theorem history_matches {s : State} (h : Reachable s) : HistoryMatches s := by
  induction h with
  | initial => simp [HistoryMatches, initial]
  | next _ transition ih =>
    cases transition with
    | edit => exact ih
    | base => exact ih
    | replace => exact ih
    | approve r valid =>
      have same := valid_review_matches valid
      intro pair member
      simp only [List.mem_cons] at member
      rcases member with equal | old
      · subst pair; exact same
      · exact ih pair old

theorem approved_revision_is_reviewed {s : State} (h : Reachable s)
    {reviewed merged : Revision} (member : (reviewed, merged) ∈ s.accepted) :
    reviewed = merged := history_matches h (reviewed, merged) member

theorem changed_head_rejected {s : State} {r : Revision}
    (different : r.head ≠ s.current.head) : ¬ ValidReview s r := by
  intro valid
  exact different valid.2.2.1

theorem changed_base_rejected {s : State} {r : Revision}
    (different : r.base ≠ s.current.base) : ¬ ValidReview s r := by
  intro valid
  exact different valid.2.2.2

theorem replaced_proposal_rejected {s : State} {r : Revision}
    (different : r.proposalId ≠ s.current.proposalId) : ¬ ValidReview s r := by
  intro valid
  exact different valid.2.1

/-- The old approval consumed a moving branch without a reviewed-revision guard. -/
inductive OldStep : State → State → Prop where
  | edit (s : State) (head : Nat) :
      OldStep s { s with current := { s.current with head := head } }
  | approve (s : State) (r : Revision) :
      OldStep s { s with isOpen := false, accepted := (r, s.current) :: s.accepted }

inductive OldReachable : State → Prop where
  | initial : OldReachable initial
  | next {a b : State} : OldReachable a → OldStep a b → OldReachable b

theorem old_approval_can_merge_unreviewed :
    ∃ s, OldReachable s ∧ ¬ HistoryMatches s := by
  let edited : State := { initial with current := ⟨1, 1, 0⟩ }
  let approved : State := { edited with
    isOpen := false
    accepted := (initial.current, edited.current) :: edited.accepted }
  refine ⟨approved, .next (.next .initial (.edit initial 1)) (.approve edited initial.current), ?_⟩
  simp [HistoryMatches, approved, edited, initial]

#print axioms valid_review_matches
#print axioms history_matches
#print axioms approved_revision_is_reviewed
#print axioms changed_head_rejected
#print axioms changed_base_rejected
#print axioms replaced_proposal_rejected
#print axioms old_approval_can_merge_unreviewed

end Specman.Approval
