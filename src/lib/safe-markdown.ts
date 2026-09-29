import { Renderer, marked, type Tokens } from 'marked';

/**
 * Markdown to HTML for the preview pane, with raw HTML neutralised.
 *
 * Chapter prose is written by the model out of whatever the user typed, and
 * every colleague in the organisation reads the same document. `marked` does not
 * sanitise — the `sanitize` option was removed in v7 and its `html` renderer
 * returns the source verbatim — so rendering its output with `{@html}` puts
 * whatever reached a chapter into everyone else's session.
 *
 * Two holes, both closed here rather than in the component:
 *
 *  1. Raw HTML. `<img src=x onerror=…>` in a chapter is markup as far as marked
 *     is concerned. Escaped, so it shows as the text it is.
 *
 *  2. Link and image URLs. marked's `cleanUrl` only runs `encodeURI`; it does
 *     not look at the scheme, so `[click](javascript:…)` renders as a working
 *     `href`. Only http, https, mailto, tel and relative URLs survive.
 *
 * Deliberately an allow-list. A deny-list of schemes is a list of the attacks
 * someone thought of, and this has to hold against text the model chose.
 *
 * Not under `$lib/server/` because the preview renders on the client too, and
 * SvelteKit refuses a server-only import there.
 */

const ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;'
};

export function escapeHtml(text: string): string {
	return (text ?? '').replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

const SAFE_SCHEME = /^(?:https?|mailto|tel):/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The URL if it is safe to put in an `href` or `src`, otherwise null.
 *
 * Whitespace and control characters are stripped before the scheme is read:
 * browsers ignore them when resolving one, so `java\tscript:alert(1)` is a
 * working `javascript:` URL and must not pass for a relative path.
 */
export function safeUrl(href: string): string | null {
	const raw = (href ?? '').trim();
	// eslint-disable-next-line no-control-regex
	const bare = raw.replace(/[\u0000- ]/g, '');

	if (!HAS_SCHEME.test(bare)) return raw; // relative, absolute path, or #fragment
	return SAFE_SCHEME.test(bare) ? raw : null;
}

class SafeRenderer extends Renderer {
	/** Covers both block-level and inline HTML — the parser routes both here. */
	override html({ text }: Tokens.HTML | Tokens.Tag): string {
		return escapeHtml(text);
	}

	override link(token: Tokens.Link): string {
		// Keep the words, drop the link: the text is the user's content and
		// throwing it away would be a worse surprise than a dead phrase.
		if (safeUrl(token.href) === null) return this.parser.parseInline(token.tokens);
		return super.link(token);
	}

	override image(token: Tokens.Image): string {
		if (safeUrl(token.href) === null) return escapeHtml(token.text);
		return super.image(token);
	}
}

const renderer = new SafeRenderer();

export function renderMarkdown(markdown: string): string {
	if (!markdown?.trim()) return '';
	return marked.parse(markdown, { breaks: true, gfm: true, renderer }) as string;
}
