/**
 * What the assistant is doing, in the words the chat shows.
 *
 * The turn's `activity` events say it in a word — writing, noting, checking —
 * and the chapter it concerns by key. This is the sentence a colleague reads
 * instead of an empty bubble.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

export interface Activity {
	doing: string;
	/** The chapter concerned, by key. */
	chapter: string | null;
}

/** Words in a chapter being written, for "Writing … 420 words". */
export function wordCount(markdown: string): number {
	return markdown.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

export function describeActivity(activity: Activity | null, title: string | null, words = 0): string {
	switch (activity?.doing) {
		case 'writing': {
			const count = words > 0 ? ` — ${words} word${words === 1 ? '' : 's'} so far` : '';
			return title ? `Writing “${title}”${count}…` : `Writing the chapter${count}…`;
		}
		case 'reading':
			return title ? `Reading “${title}”…` : 'Reading the document…';
		case 'noting':
			return 'Noting what was settled…';
		case 'replying':
			return 'Replying…';
		case 'checking':
			return 'Checking what is still open…';
		case 'saving':
			return 'Saving to the history…';
		default:
			return 'Thinking…';
	}
}
