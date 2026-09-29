export type ChapterStatus = 'empty' | 'in_progress' | 'complete';

export interface User {
	id: number;
	username: string;
	display_name: string;
	is_admin: number;
	created_at: string;
}

export interface Template {
	id: number;
	name: string;
	description: string;
	is_default: number;
}

export interface TemplateChapter {
	id: number;
	template_id: number;
	key: string;
	title: string;
	/** One sentence, shown to the user: what this chapter is for. */
	goal: string;
	/** Guidance for the agent: what this chapter must establish. */
	purpose: string;
	/** Questions the agent works through with the user. */
	questions: string[];
	/** Conditions that must hold before the chapter counts as complete. */
	criteria: string[];
	position: number;
	/** Dynamic chapters describe the specific application, not fixed governance topics. */
	is_dynamic: number;
	/** Conditions under which this chapter is worth asking about. */
	applies_when: string[];
}

export interface Project {
	id: number;
	name: string;
	slug: string;
	description: string;
	template_id: number;
	owner_id: number;
	repo_path: string;
	created_at: string;
	/** Triage answers deciding which chapters apply. See `llm/profile.ts`. */
	profile: string;
	/** `change` means the application already exists and is being modified. */
	kind: 'new' | 'change';
	/** Monotonic guard for asynchronous computations over the whole document. */
	document_revision: number;
}

/** now = build it; later = agreed but not yet; out = explicitly not doing. */
export type RequirementScope = 'now' | 'later' | 'out';

export interface Requirement {
	id: number;
	project_id: number;
	chapter_key: string;
	/** Stable for life, assigned by the server: REQ-007. */
	ref: string;
	statement: string;
	scope: RequirementScope;
	scenarios: Array<{ when: string; then: string }>;
	/** Who it came from. `standard` is inherited from an organisation default. */
	source: 'user' | 'agent' | 'standard';
	/** 1 when this describes how the application already behaves today. */
	existing: number;
	position: number;
	created_at: string;
	updated_at: string;
}

/** A company-wide rule, inherited by applications it applies to. */
export interface Standard {
	id: number;
	chapter_key: string;
	statement: string;
	scenarios: Array<{ when: string; then: string }>;
	applies_when: string[];
	active: number;
	position: number;
}

export interface Decision {
	id: number;
	project_id: number;
	chapter_key: string;
	statement: string;
	rationale: string;
	/** `agent` means the assistant chose a default on the user's behalf. */
	source: 'user' | 'agent' | 'standard';
	/** Anything not made by the user stays `proposed` until they confirm it. */
	status: 'proposed' | 'confirmed';
	created_at: string;
	confirmed_at: string | null;
}

export interface Chapter {
	id: number;
	project_id: number;
	key: string;
	title: string;
	/** One sentence, shown to the user: what this chapter is for. */
	goal: string;
	purpose: string;
	questions: string[];
	criteria: string[];
	position: number;
	is_dynamic: number;
	status: ChapterStatus;
	open_questions: string[];
	content_md: string;
	updated_at: string;
	/** Conditions under which this chapter is worth asking about. */
	applies_when: string[];
	/** 0 when the triage set it aside. Marked, never deleted. */
	applicable: number;
	skip_reason: string;
	/** Empty for a top-level chapter; otherwise the parent's key. */
	parent_key: string;
	/** 0 for top level, 1 for a sub-chapter. Computed, not stored. */
	depth?: number;
}

/**
 * One answer the agent offers to its own question. The user picks one or types
 * their own — the decision is always theirs.
 */
export interface AnswerOption {
	label: string;
	/** Exactly one option in a set carries this. */
	recommended: boolean;
}

export interface Message {
	id: number;
	project_id: number;
	/** null = the whole-document conversation, which is its own thread. */
	chapter_key: string | null;
	role: 'user' | 'assistant';
	content: string;
	/** Answers offered alongside an assistant question. Empty when none apply. */
	options: AnswerOption[];
	created_at: string;
}

export type ProposalState = 'draft' | 'in_review' | 'merged';

export interface Proposal {
	id: number;
	project_id: number;
	branch: string;
	title: string;
	state: ProposalState;
	created_at: string;
	merged_at: string | null;
}
