/**
 * Which chapters an application actually needs.
 *
 * A tool for five people in one office should not face the same compliance
 * battery as something holding personal data for the whole company. Asking
 * anyway wastes the user's time and — worse — teaches them that most of the
 * document is box-ticking, which is exactly when people start answering
 * carelessly.
 *
 * A handful of questions at the start decide which fixed chapters apply. A
 * chapter that does not apply is *marked*, never deleted: an auditor should be
 * able to see the judgement, and the user can always overrule it.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

export type Reach = 'team' | 'company' | 'external';

export interface Profile {
	/** How far the application reaches. */
	reach: Reach;
	/** Does it hold anything about identifiable people? */
	personalData: boolean;
	/** Does it touch money, safety, or records someone is legally required to keep? */
	critical: boolean;
}

/** Conditions a chapter can carry. A chapter applies if ANY of them hold. */
export type Condition = 'always' | 'personal_data' | 'beyond_team' | 'external' | 'critical';

export const DEFAULT_PROFILE: Profile = {
	reach: 'company',
	personalData: true,
	critical: false
};

/**
 * Read a profile from whatever is stored.
 *
 * Missing or unreadable values fall back to the cautious answer: a document that
 * asks too much is a nuisance, one that quietly skips data classification for an
 * application holding personal data is a problem.
 */
export function toProfile(raw: unknown): Profile {
	const value = (raw ?? {}) as Partial<Profile>;
	const reach: Reach =
		value.reach === 'team' || value.reach === 'external' || value.reach === 'company'
			? value.reach
			: DEFAULT_PROFILE.reach;

	return {
		reach,
		personalData: value.personalData !== false,
		critical: value.critical === true
	};
}

export function holds(condition: Condition, profile: Profile): boolean {
	switch (condition) {
		case 'always':
			return true;
		case 'personal_data':
			return profile.personalData;
		case 'beyond_team':
			return profile.reach !== 'team';
		case 'external':
			return profile.reach === 'external';
		case 'critical':
			return profile.critical;
		default:
			// An unrecognised condition must not silently remove a chapter.
			return true;
	}
}

export function chapterApplies(conditions: string[], profile: Profile): boolean {
	if (!conditions || conditions.length === 0) return true;
	return conditions.some((condition) => holds(condition as Condition, profile));
}

/** Why a chapter was set aside, in the user's terms. */
export function reasonForSkipping(conditions: string[], profile: Profile): string {
	const bits: string[] = [];
	if (conditions.includes('personal_data') && !profile.personalData) {
		bits.push('it holds nothing about identifiable people');
	}
	if (conditions.includes('beyond_team') && profile.reach === 'team') {
		bits.push('it is used by one team only');
	}
	if (conditions.includes('external') && profile.reach !== 'external') {
		bits.push('nobody outside the company uses it');
	}
	if (conditions.includes('critical') && !profile.critical) {
		bits.push('it does not touch money, safety, or legally required records');
	}

	if (bits.length === 0) return 'Set aside for this application.';

	const last = bits.pop()!;
	const reason = bits.length > 0 ? `${bits.join(', ')} and ${last}` : last;
	return `Set aside because ${reason}.`;
}

/** One line describing the application's shape, for the assistant's context. */
export function describeProfile(profile: Profile): string {
	const reach = {
		team: 'used by a single team',
		company: 'used across Škoda Auto',
		external: 'reaches people outside the company'
	}[profile.reach];

	return [
		reach,
		profile.personalData ? 'holds personal data' : 'holds no personal data',
		profile.critical
			? 'touches money, safety, or legally required records'
			: 'does not touch money, safety, or legally required records'
	].join('; ');
}
