/**
 * What to tell the user when the assistant could not do something.
 *
 * The exception's own message was shown verbatim, so a colleague who commissions
 * software was told "Gateway stream failed with 502", "fetch failed", or the text
 * of a SQLite error. None of that is theirs to act on. What they can act on is
 * whether their words were kept and whether trying again will help, so that is
 * all this says; the cause goes to the log.
 *
 * Matched on names and wording rather than classes, so this module needs no
 * imports and `npm test` can load it directly.
 */

export interface FailureContext {
	/** Whether the user's own message was stored before the failure. */
	messageSaved?: boolean;
}

function kept(context: FailureContext): string {
	return context.messageSaved === false ? '' : ' Your message is saved.';
}

export function describeFailure(cause: unknown, context: FailureContext = {}): string {
	const error = cause instanceof Error ? cause : null;
	const name = error?.name ?? '';
	const message = error?.message ?? '';

	// Already written for the user, and the advice in it is specific.
	if (name === 'DocumentConflict') return message;

	if (/ran out of room/i.test(message)) {
		return (
			'That was more than the assistant could write in one go.' +
			kept(context) +
			' Try asking for one part at a time.'
		);
	}

	if (
		name === 'GatewayError' ||
		name === 'AbortError' ||
		/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket|network/i.test(message)
	) {
		return 'The assistant cannot be reached just now.' + kept(context) + ' Try again in a minute.';
	}

	return 'Something went wrong while the assistant was working.' + kept(context) + ' Try again.';
}
