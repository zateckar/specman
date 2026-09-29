import Std
set_option autoImplicit false

namespace Specman.Recovery

inductive Phase where
  | idle | prepared | merged | complete
  deriving DecidableEq

/-- One journal entry. All fields survive crashes; volatile work is omitted. -/
structure State where
  authorized : Option Nat
  gitEvidence : Option Nat
  closed : Bool
  phase : Phase
  deriving DecidableEq

def idle : State := ⟨none, none, false, .idle⟩
def prepared (token : Nat) : State := ⟨some token, none, false, .prepared⟩
def mergedGit (token : Nat) : State := ⟨some token, some token, false, .prepared⟩
def recorded (token : Nat) : State := ⟨some token, some token, true, .merged⟩
def complete (token : Nat) : State := ⟨some token, some token, true, .complete⟩

inductive Step : State → State → Prop where
  | authorize (token : Nat) : Step idle (prepared token)
  | merge (token : Nat) : Step (prepared token) (mergedGit token)
  | record (token : Nat) : Step (mergedGit token) (recorded token)
  | bundle (token : Nat) : Step (recorded token) (complete token)
  | crashOrBlocked (s : State) : Step s s

inductive Reachable : State → Prop where
  | initial : Reachable idle
  | next {a b : State} : Reachable a → Step a b → Reachable b

def Safe (s : State) : Prop :=
  (s.closed = true → s.gitEvidence = s.authorized ∧ s.authorized ≠ none) ∧
  (s.phase = .complete → s.closed = true)

theorem closure_requires_authorized_merge {s : State} (h : Reachable s) : Safe s := by
  induction h with
  | initial => simp [Safe, idle]
  | next _ step ih =>
    cases step <;> simp_all [Safe, prepared, mergedGit, recorded, complete]

/-- The result after forward recovery succeeds; blocked recovery leaves durable state.
    The implementation performs merge, record and bundle as separate steps above. -/
def recover (blocked : Bool) (s : State) : State :=
  if blocked then s else match s.authorized with
  | none => s
  | some token => complete token

inductive Path (start : State) : State → Prop where
  | initial : Path start start
  | next {a b : State} : Path start a → Step a b → Path start b

/-- Successful recovery is a legal sequence of the same durable protocol steps. -/
theorem recovery_follows_protocol {s : State} (h : Reachable s) : Path s (recover false s) := by
  induction h with
  | initial => simpa [recover, idle] using (Path.initial : Path idle idle)
  | next _ step ih =>
    cases step with
    | authorize token =>
      have legal : Path (prepared token) (complete token) :=
        .next (.next (.next .initial (.merge token)) (.record token)) (.bundle token)
      simpa [recover, prepared] using legal
    | merge token =>
      have legal : Path (mergedGit token) (complete token) :=
        .next (.next .initial (.record token)) (.bundle token)
      simpa [recover, mergedGit] using legal
    | record token =>
      have legal : Path (recorded token) (complete token) := .next .initial (.bundle token)
      simpa [recover, recorded] using legal
    | bundle token =>
      simpa [recover, complete] using (Path.initial : Path (complete token) (complete token))
    | crashOrBlocked => exact ih

theorem recovery_uses_durable_authorization {s : State} {token : Nat}
    (intent : s.authorized = some token) :
    (recover false s).gitEvidence = some token ∧ (recover false s).closed = true := by
  simp [recover, intent, complete]

theorem successful_recovery_completes {s : State} {token : Nat}
    (intent : s.authorized = some token) : (recover false s).phase = .complete := by
  simp [recover, intent, complete]

theorem recovery_is_idempotent (s : State) : recover false (recover false s) = recover false s := by
  cases intent : s.authorized <;> simp [recover, intent, complete]

theorem recovery_never_invents_authorization (s : State) : (recover false s).authorized = s.authorized := by
  cases intent : s.authorized <;> simp [recover, intent, complete]

theorem blocked_recovery_preserves_state (s : State) : recover true s = s := by simp [recover]

theorem merge_can_outlive_its_database_marker (token : Nat) :
    Reachable (mergedGit token) ∧ (mergedGit token).closed = false := by
  exact ⟨.next (.next .initial (.authorize token)) (.merge token), rfl⟩

#print axioms closure_requires_authorized_merge
#print axioms recovery_follows_protocol
#print axioms recovery_uses_durable_authorization
#print axioms successful_recovery_completes
#print axioms recovery_is_idempotent
#print axioms recovery_never_invents_authorization
#print axioms blocked_recovery_preserves_state
#print axioms merge_can_outlive_its_database_marker
end Specman.Recovery
