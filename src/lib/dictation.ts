/**
 * Turning what the browser heard into the text of an answer.
 *
 * The browser's speech recognition reports a list of results, each either final
 * or still being revised. The answer box shows all of them as they arrive, after
 * whatever the user had already typed, so speaking adds to an answer rather than
 * replacing it.
 *
 * Runs in the browser. Deliberately free of imports so `npm test` can load it
 * directly.
 */

export interface HeardSegment {
	transcript: string;
	isFinal: boolean;
}

/** Languages offered for speaking, in the order shown. */
export const SPOKEN_LANGUAGES = [
	{ tag: 'cs-CZ', label: 'Čeština' },
	{ tag: 'en-US', label: 'English' },
	{ tag: 'de-DE', label: 'Deutsch' },
	{ tag: 'sk-SK', label: 'Slovenčina' }
] as const;

/** Everything heard so far, final and provisional, as one sentence-spaced string. */
export function spokenText(segments: HeardSegment[]): string {
	return segments
		.map((s) => s.transcript)
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** What was typed before speaking, followed by what was said. */
export function joinDictation(typed: string, spoken: string): string {
	if (!spoken) return typed;
	if (!typed.trim()) return spoken;
	return /\s$/.test(typed) ? typed + spoken : `${typed} ${spoken}`;
}

/**
 * The offered language closest to the browser's own, so a Czech browser starts
 * in Czech. Falls back to the first offered when nothing matches.
 */
export function defaultSpokenLanguage(preferred: readonly string[]): string {
	for (const wanted of preferred) {
		const base = wanted.toLowerCase().split('-')[0];
		const match = SPOKEN_LANGUAGES.find((l) => l.tag.toLowerCase().split('-')[0] === base);
		if (match) return match.tag;
	}
	return SPOKEN_LANGUAGES[0].tag;
}

/** A recognition error, said the way the user can act on it. Empty to say nothing. */
export function describeDictationError(code: string): string {
	switch (code) {
		case 'not-allowed':
		case 'service-not-allowed':
			return 'The microphone is blocked. Allow it for this page in the browser, then try again.';
		case 'audio-capture':
			return 'No microphone was found.';
		case 'network':
			return 'The speech service could not be reached. You can type your answer instead.';
		case 'language-not-supported':
			return 'Your browser cannot transcribe this language. Pick another, or type your answer.';
		// Silence, or the user stopping it: nothing went wrong.
		case 'no-speech':
		case 'aborted':
			return '';
		default:
			return 'Speech could not be transcribed. You can type your answer instead.';
	}
}
