/**
 * What the user is told while a turn is being written.
 *
 * The model writes the chapter first and its short reply last, so for most of a
 * turn nothing it says is meant for the chat. Shown nothing, the user watched an
 * empty bubble for a minute while text arrived the whole time. This says what
 * the assistant is doing, and passes on the chapter as it is written so the
 * document can show it growing.
 *
 * The order is not changed to put the reply first. Blocks first is what keeps a
 * model that stops early from stopping before it has written anything down.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

export type Doing = 'thinking' | 'reading' | 'writing' | 'noting' | 'replying';

/** The block being written, as `ChapterStreamParser.writing` reports it. */
export interface OpenBlock {
	index: number;
	tag: string;
	attrs: Record<string, string>;
	body: string;
}

export interface ProgressUpdate {
	/** What the assistant is doing now, when that has changed. */
	activity?: { doing: Doing; chapter: string | null };
	/** More of a chapter being written: appended, or the whole of it once it closes. */
	drafts: Array<{ chapter: string; delta?: string; markdown?: string }>;
}

/** Often enough to read as live, seldom enough not to send a chapter a character at a time. */
export const DRAFT_EVERY_MS = 250;

export class TurnProgress {
	private doing: Doing = 'thinking';
	private chapter: string | null = null;
	private draftIndex = -1;
	private draftChapter: string | null = null;
	private sent = 0;
	private lastSent = -Infinity;
	private readonly now: () => number;

	constructor(now: () => number = Date.now) {
		this.now = now;
	}

	/**
	 * Something the turn does between the model's words, such as reading a
	 * chapter, in the same terms — so the next chunk is compared with it and the
	 * chat does not go on saying "reading" once the model is writing again.
	 */
	announce(doing: Doing, chapter: string | null): { doing: Doing; chapter: string | null } {
		this.doing = doing;
		this.chapter = chapter;
		return { doing, chapter };
	}

	/**
	 * Called after every chunk with the block now open, every block closed so
	 * far, and whether any of the reply itself was passed on in this chunk.
	 *
	 * @param chapterKey The chapter a chapter block is for, resolved by the
	 *   caller — the block names it as the model wrote it.
	 */
	observe(
		open: OpenBlock | null,
		closed: ReadonlyArray<{ tag: string; body: string }>,
		replied: boolean,
		chapterKey: (attrs: Record<string, string>) => string | null
	): ProgressUpdate {
		const update: ProgressUpdate = { drafts: [] };

		// A chapter that has just closed is sent whole: the last characters were
		// held back for the closing tag, and the body is trimmed once closed.
		const finished = this.draftIndex >= 0 ? closed[this.draftIndex] : undefined;
		if (finished && this.draftChapter) {
			update.drafts.push({ chapter: this.draftChapter, markdown: finished.body });
			this.draftIndex = -1;
		}

		let doing: Doing;
		let chapter: string | null = null;
		if (open?.tag === 'chapter' || open?.tag === 'section') {
			// A section is shown as writing, but not passed on as the chapter: it is
			// one part of it, and the document would show that part as the whole.
			doing = 'writing';
			chapter = chapterKey(open.attrs);
		} else if (open?.tag === 'requirement' || open?.tag === 'decision') {
			doing = 'noting';
		} else if (open) {
			doing = this.doing; // suggested answers, an arrangement: nothing worth naming
		} else if (replied) {
			doing = 'replying';
		} else {
			// Between blocks the model is deciding what comes next, which is thinking.
			doing = this.doing === 'replying' ? 'replying' : 'thinking';
		}
		if (doing !== this.doing || chapter !== this.chapter) {
			update.activity = { doing, chapter };
			this.doing = doing;
			this.chapter = chapter;
		}

		if (open?.tag === 'chapter' && chapter) {
			if (open.index !== this.draftIndex) {
				this.draftIndex = open.index;
				this.draftChapter = chapter;
				this.sent = 0;
				this.lastSent = -Infinity;
			}
			const now = this.now();
			if (open.body.length > this.sent && now - this.lastSent >= DRAFT_EVERY_MS) {
				update.drafts.push({ chapter, delta: open.body.slice(this.sent) });
				this.sent = open.body.length;
				this.lastSent = now;
			}
		}

		return update;
	}
}
