/**
 * Pulling structured blocks out of the agent's token stream.
 *
 * The agent writes several things inside its streamed reply that the user must
 * never see as raw text:
 *
 *   <chapter key="security">        the rewritten chapter
 *   <options>                       answers offered for its question
 *   <requirement scope="now">       something that must always be true
 *
 * All of them are streamed rather than sent as tool arguments — see the header
 * of `gateway.ts` for why a long tool argument is a hard failure on this gateway.
 *
 * Text is held back only while a partial tag might still be forming, so ordinary
 * prose still streams token by token.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

export type BlockTag =
	| 'chapter'
	| 'options'
	| 'requirement'
	| 'decision'
	| 'finding'
	| 'subchapters'
	| 'element'
	| 'relation';

export interface ParsedBlock {
	tag: BlockTag;
	attrs: Record<string, string>;
	body: string;
}

// All distinct words, so ordinary alternation is unambiguous.
const TAGS = 'chapter|options|requirement|decision|finding|subchapters|element|relation';
// Either quote. The models write `key='x'` often enough that refusing it printed
// the raw tag and the whole chapter into the chat, and saved nothing.
const ATTRIBUTE_SOURCE = `[a-z_]+\\s*=\\s*(?:"[^"]*"|'[^']*')`;
const BLOCK_OPEN = new RegExp(`<(${TAGS})((?:\\s+${ATTRIBUTE_SOURCE})*)\\s*(/?)>`, 'i');

/**
 * Tags that carry everything in their attributes and have no body.
 *
 * Requiring `</element>` after an element that says nothing more would be noise
 * the model has to remember, and forgetting it would swallow the rest of the
 * stream into one enormous block. These close as soon as they open, with or
 * without a self-closing slash.
 */
const VOID_TAGS = new Set<BlockTag>(['element', 'relation']);
const ATTRIBUTE = /([a-z_]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const LONGEST_CLOSE = '</requirement>'.length;

/**
 * Could this tail still become an opening tag?
 *
 * A fixed character window is not enough: `<requirement chapter="data-classification"
 * scope="later">` is far longer than any sensible window, and treating it as
 * ordinary text would print the raw tag into the chat. Matching the shape
 * instead means a long tag is held for as long as it takes, while a stray `<`
 * in prose flushes immediately.
 */
const PARTIAL_TAG = new RegExp(`^<(?:[a-z]*|(?:${TAGS})\\b[^<>]*)$`, 'i');

function parseAttributes(raw: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	for (const match of raw.matchAll(ATTRIBUTE)) attrs[match[1].toLowerCase()] = match[2] ?? match[3];
	return attrs;
}

/** Where the next block opens in `text`, if one does. */
function nextOpening(text: string): number {
	const match = BLOCK_OPEN.exec(text);
	return match ? match.index : -1;
}

export class ChapterStreamParser {
	private buffer = '';
	private open: { tag: BlockTag; attrs: Record<string, string> } | null = null;
	private blockBuffer = '';
	/** Starts at 2 so newlines leading the whole reply are swallowed too. */
	private trailingNewlines = 2;

	/** Every block seen this turn, in the order the agent wrote them. */
	readonly blocks: ParsedBlock[] = [];
	/**
	 * Chapter markdown the agent rewrote, keyed by chapter key as written.
	 *
	 * A block with no key is kept under `''` rather than dropped: the agent is
	 * nearly always writing the chapter it was asked about, and only the caller
	 * knows which that is. An empty block is not kept at all — nobody means to
	 * erase a chapter by writing nothing into it.
	 */
	readonly drafts = new Map<string, string>();
	/** Raw body of the last <options> block; read it with `parseOptions`. */
	optionsBlock = '';

	/** Feed a chunk; returns the text safe to show the user. */
	push(chunk: string): string {
		this.buffer += chunk;
		let out = '';

		while (this.buffer.length > 0) {
			if (this.open === null) {
				const match = BLOCK_OPEN.exec(this.buffer);
				if (match) {
					out += this.buffer.slice(0, match.index);
					this.buffer = this.buffer.slice(match.index + match[0].length);

					const tag = match[1].toLowerCase() as BlockTag;
					this.open = { tag, attrs: parseAttributes(match[2] ?? '') };
					this.blockBuffer = '';

					// A void tag is already complete; anything after it is prose again.
					if (VOID_TAGS.has(tag) || match[3] === '/') this.closeBlock();
					continue;
				}

				const partial = this.buffer.lastIndexOf('<');
				if (partial !== -1 && PARTIAL_TAG.test(this.buffer.slice(partial))) {
					out += this.buffer.slice(0, partial);
					this.buffer = this.buffer.slice(partial);
				} else {
					out += this.buffer;
					this.buffer = '';
				}
				break;
			}

			const closeTag = `</${this.open.tag}>`;
			const close = this.buffer.indexOf(closeTag);
			if (close === -1) {
				// Keep a tail in case the closing tag is split across chunks.
				const keep = Math.max(0, this.buffer.length - LONGEST_CLOSE);
				this.blockBuffer += this.buffer.slice(0, keep);
				this.buffer = this.buffer.slice(keep);
				break;
			}

			this.blockBuffer += this.buffer.slice(0, close);
			this.closeBlock();
			this.buffer = this.buffer.slice(close + closeTag.length);
		}

		return this.squeeze(out);
	}

	/**
	 * Flush anything held back. Call once the stream ends.
	 *
	 * A block still open here was never closed. Truncation is not the cause — the
	 * gateway refuses a reply that ran out of room — so the model finished and
	 * forgot the closing tag. What it wrote after the block is then still in the
	 * block: the requirements, the decisions and the reply. Blocks never nest, so
	 * the next opening tag is where this one must have ended, and everything from
	 * there is parsed as the reply it was.
	 */
	end(): string {
		if (this.open !== null) {
			const held = this.blockBuffer + this.buffer;
			const cut = nextOpening(held);
			this.blockBuffer = cut === -1 ? held : held.slice(0, cut);
			this.buffer = '';
			this.closeBlock();
			if (cut === -1) return '';
			return this.push(held.slice(cut)) + this.end();
		}
		const rest = this.buffer;
		this.buffer = '';
		return this.squeeze(rest);
	}

	/** Blocks of one kind, in order. */
	blocksOf(tag: BlockTag): ParsedBlock[] {
		return this.blocks.filter((b) => b.tag === tag);
	}

	/**
	 * Collapse runs of blank lines in the visible text.
	 *
	 * Removing a block leaves the newlines that surrounded it behind, and several
	 * requirements in one reply leave a visible hole in the chat. Counting across
	 * chunks matters: the newlines arrive either side of a block, in separate
	 * calls, so a per-chunk regex would not see them together.
	 */
	private squeeze(text: string): string {
		let out = '';
		for (const character of text) {
			if (character === '\n') {
				this.trailingNewlines += 1;
				if (this.trailingNewlines <= 2) out += character;
			} else {
				this.trailingNewlines = 0;
				out += character;
			}
		}
		return out;
	}

	private closeBlock(): void {
		if (!this.open) return;

		const block: ParsedBlock = {
			tag: this.open.tag,
			attrs: this.open.attrs,
			body: this.blockBuffer.trim()
		};
		this.blocks.push(block);

		// Convenience views for the two callers that predate `blocks`.
		if (block.tag === 'chapter') {
			if (block.body) this.drafts.set((block.attrs.key ?? '').trim().toLowerCase(), block.body);
		} else if (block.tag === 'options') {
			this.optionsBlock = block.body;
		}

		this.open = null;
		this.blockBuffer = '';
	}
}
