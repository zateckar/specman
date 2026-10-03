/**
 * How much room each model call is given.
 *
 * `max_tokens` is working room for the reasoning as well as the answer: the
 * served models think before they write, and both come out of one budget. A call
 * that runs out fails, and when it was still reasoning it fails with nothing. So
 * every figure here is at least twice the most a call of its kind has been seen
 * to use, and none that reads a whole chapter or document is below 16 000.
 *
 * Room costs nothing unused: a call stops when its answer is done. What it costs
 * is time when a model deliberates without end, because the call fails only once
 * the room is spent, so twice the room is twice the wait before a retry. The
 * trade made here is answers that fit over failures that come sooner.
 *
 * The primary gateway accepted every figure up to a million, and the room is
 * real: given 64 000, one answer ran to 35 728 tokens and finished, at about a
 * hundred tokens a second (measured on 2026-10-03). So these are ours to choose.
 * Gemini's own ceiling is applied in `gemini-format.ts`, and nothing here asks
 * for more than it.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

/**
 * A conversation turn: the chapter rewritten whole, with its rules and decisions,
 * after the reasoning. A drafted chapter, which is the same writing, has used
 * 14 261; at 6000 a chapter of a few thousand words could not be written at all.
 */
export const TURN_BUDGET = 32_000;

/**
 * Assessing a chapter: a forced tool call of a few words, made after reading all
 * of it. Truncation inside a tool call is a hard 400 with nothing usable.
 */
export const ASSESS_BUDGET = 16_000;

/**
 * Answers to offer for an open question: a handful of words, after reading the
 * chapter. At 400 it deliberated and wrote nothing.
 */
export const OPTIONS_BUDGET = 16_000;

/** Checking a chapter, or the whole document, against what it must say. */
export const CHECK_BUDGET = 24_000;

/**
 * Each half of drawing the diagram, naming the parts and then connecting them.
 * At 4000 both returned nothing; the answer itself is a few hundred bytes.
 */
export const DIAGRAM_BUDGET = 24_000;

/** Drafting a chapter: the same writing as a turn. */
export const DRAFT_BUDGET = 32_000;

/** Drafting it again, when the first ran out of room or wrote no chapter. */
export const DRAFT_RETRY_BUDGET = 48_000;

/** Deciding a mock-up's screens. It has used 2 065 and 4 606. */
export const SCREENS_BUDGET = 16_000;

/** Writing a mock-up's page. A compact page has used 25 168. */
export const MOCKUP_BUDGET = 64_000;

/** A prose call that names no budget of its own. */
export const DEFAULT_BUDGET = 16_000;
