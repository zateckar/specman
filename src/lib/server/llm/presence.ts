/**
 * Who else is in this application right now, and who is writing.
 *
 * Ordering repository writes stopped two turns corrupting each other, but it
 * cannot stop two colleagues describing the same chapter and the second one's
 * version being the one that survives. Nothing here prevents that — a design
 * conversation is not a text editor and locking a chapter would be worse than
 * the problem. What it does is make the collision *visible*, which is the part
 * the user can act on: someone who can see that a colleague is in the same
 * document, writing, will wait or go and talk to them.
 *
 * Deliberately in memory rather than in SQLite. Presence is true for about a
 * minute and is a claim about live connections — after a restart nobody is
 * connected, so a restart clearing it is correct rather than a loss. It is
 * per-process for the same reason the repository lock is; that limit is in
 * `PLAN.md`.
 *
 * Deliberately free of imports so `npm test` can load it directly. Time is
 * passed in rather than read, so the expiry can be tested without waiting for it.
 */

export interface Watcher {
	name: string;
	/** Mid-turn: the assistant is writing into the document for them right now. */
	writing: boolean;
}

export interface Presence {
	/** Record that someone is looking at this application. */
	seen(projectId: number, userId: number, name: string, now: number): void;
	/** Record that a turn has started or finished for them. */
	setWriting(projectId: number, userId: number, writing: boolean, now: number): void;
	/** Everyone else currently present, most recently seen first. */
	others(projectId: number, userId: number, now: number): Watcher[];
	/** How many people are being tracked. For tests and diagnostics. */
	readonly size: number;
}

interface Entry {
	name: string;
	lastSeen: number;
	writing: boolean;
}

/**
 * @param ttlMs How long after their last sign of life someone is still counted
 *   as present. Wants to be comfortably more than the client's polling interval,
 *   or somebody sitting still will flicker in and out of the list.
 */
export function createPresence(ttlMs = 45_000): Presence {
	const byProject = new Map<number, Map<number, Entry>>();

	function watchers(projectId: number): Map<number, Entry> {
		let found = byProject.get(projectId);
		if (!found) {
			found = new Map<number, Entry>();
			byProject.set(projectId, found);
		}
		return found;
	}

	function sweep(now: number): void {
		for (const [projectId, people] of byProject) {
			for (const [userId, entry] of people) {
				if (now - entry.lastSeen > ttlMs) people.delete(userId);
			}
			if (people.size === 0) byProject.delete(projectId);
		}
	}

	return {
		seen(projectId: number, userId: number, name: string, now: number) {
			const people = watchers(projectId);
			const entry = people.get(userId);
			if (entry) {
				entry.lastSeen = now;
				entry.name = name;
			} else {
				people.set(userId, { name, lastSeen: now, writing: false });
			}
			sweep(now);
		},

		setWriting(projectId: number, userId: number, writing: boolean, now: number) {
			const people = watchers(projectId);
			const entry = people.get(userId);
			if (entry) {
				entry.writing = writing;
				entry.lastSeen = now;
			} else {
				// A turn is itself a sign of life, so someone who started one without
				// having been seen yet still counts as present.
				people.set(userId, { name: '', lastSeen: now, writing });
			}
			sweep(now);
		},

		others(projectId: number, userId: number, now: number): Watcher[] {
			sweep(now);
			const people = byProject.get(projectId);
			if (!people) return [];

			return [...people.entries()]
				.filter(([id, entry]) => id !== userId && now - entry.lastSeen <= ttlMs && entry.name)
				.sort((a, b) => b[1].lastSeen - a[1].lastSeen)
				.map(([, entry]) => ({ name: entry.name, writing: entry.writing }));
		},

		get size() {
			let total = 0;
			for (const people of byProject.values()) total += people.size;
			return total;
		}
	};
}

/** The one the application uses. */
export const presence = createPresence();
