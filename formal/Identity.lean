import Std
set_option autoImplicit false

namespace Specman.Identity

abbrev Key := Nat × Nat -- issuer and subject, never username
structure User where
  id : Nat
  admin : Bool
  deriving DecidableEq

inductive Result where
  | resume (user : User)
  | register (user : User)
  | collision
  deriving DecidableEq

def resolve (linked : Option User) (nameTaken : Bool) (freshId : Nat) : Result :=
  match linked with
  | some user => .resume user
  | none => if nameTaken then .collision else .register ⟨freshId, false⟩

theorem name_collision_cannot_adopt_account (freshId : Nat) :
    resolve none true freshId = .collision := rfl

theorem new_identity_is_not_admin (freshId : Nat) :
    resolve none false freshId = .register ⟨freshId, false⟩ := rfl

theorem linked_identity_ignores_username (user : User) (nameTaken : Bool) (freshId : Nat) :
    resolve (some user) nameTaken freshId = .resume user := rfl

/-- Registration is one SQLite transaction, with the unique identity key guarded. -/
def link (links : Key → Option User) (key : Key) (freshId : Nat) : Key → Option User :=
  fun k => if k = key then some ⟨freshId, false⟩ else links k

theorem registration_preserves_existing_links (links : Key → Option User) (key old : Key)
    (freshId : Nat) (user : User) (absent : links key = none) (present : links old = some user) :
    link links key freshId old = some user := by
  have different : old ≠ key := by intro same; subst old; simp_all
  simp [link, different, present]

theorem registration_links_only_ordinary_user (links : Key → Option User) (key : Key) (freshId : Nat) :
    link links key freshId key = some ⟨freshId, false⟩ := by simp [link]

#print axioms name_collision_cannot_adopt_account
#print axioms new_identity_is_not_admin
#print axioms linked_identity_ignores_username
#print axioms registration_preserves_existing_links
#print axioms registration_links_only_ordinary_user
end Specman.Identity
