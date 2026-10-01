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
 * And one that hid behind the second: marked's own image renderer writes the
 * alt text into the attribute unescaped, so `![x" onerror="…](a.png)` was a
 * handler that ran for every reader with no click at all. Links and images are
 * therefore built here, every attribute escaped, rather than handed back to
 * marked once the address passes.
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

/**
 * Character references a browser decodes inside an attribute before it reads the
 * scheme. Numeric ones may omit the semicolon; the named ones are those that can
 * spell a scheme's punctuation. Any other named reference before the path is
 * refused outright rather than decoded, so the list does not have to be complete.
 */
function decodeReferences(text: string): string {
	return text
		.replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16) % 0x110000))
		.replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(Number(dec) % 0x110000))
		.replace(/&colon;/gi, ':')
		.replace(/&tab;/gi, '\t')
		.replace(/&newline;/gi, '\n');
}

/** Everything before the first `/`, `?` or `#` — where a scheme would have to be. */
function head(url: string): string {
	const end = url.search(/[/?#]/);
	return end === -1 ? url : url.slice(0, end);
}

/**
 * The URL if it is safe to put in an `href` or `src`, otherwise null.
 *
 * Read the way a browser reads it, not the way it is written: character
 * references are decoded and whitespace and control characters stripped before
 * the scheme is looked for, so neither `java\tscript:` nor `&#106;avascript:`
 * passes for a relative path.
 */
export function safeUrl(href: string): string | null {
	const raw = (href ?? '').trim();
	// eslint-disable-next-line no-control-regex
	const strip = (text: string) => text.replace(/[\u0000- ]/g, '');
	const bare = strip(decodeReferences(raw));

	if (SAFE_SCHEME.test(bare)) return raw;
	// No scheme at all: a relative path, an absolute path or a #fragment. A
	// reference left undecoded where the scheme would be could still hide a colon.
	if (head(bare).includes(':') || head(strip(raw)).includes('&')) return null;
	return raw;
}

/** An address as an attribute value: percent-encoded as marked would, then escaped. */
function attributeUrl(url: string): string | null {
	try {
		return escapeHtml(encodeURI(url).replace(/%25/g, '%'));
	} catch {
		return null; // a lone surrogate — not an address anyone meant
	}
}

function titleAttribute(title: string | null | undefined): string {
	return title ? ` title="${escapeHtml(title)}"` : '';
}

class SafeRenderer extends Renderer {
	/** Covers both block-level and inline HTML — the parser routes both here. */
	override html({ text }: Tokens.HTML | Tokens.Tag): string {
		return escapeHtml(text);
	}

	override link(token: Tokens.Link): string {
		const words = this.parser.parseInline(token.tokens);
		const safe = safeUrl(token.href);
		const href = safe === null ? null : attributeUrl(safe);
		// Keep the words, drop the link: the text is the user's content and
		// throwing it away would be a worse surprise than a dead phrase.
		if (href === null) return words;
		return `<a href="${href}"${titleAttribute(token.title)}>${words}</a>`;
	}

	override image(token: Tokens.Image): string {
		const safe = safeUrl(token.href);
		const src = safe === null ? null : attributeUrl(safe);
		if (src === null) return escapeHtml(token.text);
		return `<img src="${src}" alt="${escapeHtml(token.text)}"${titleAttribute(token.title)}>`;
	}
}

const renderer = new SafeRenderer();

export function renderMarkdown(markdown: string): string {
	if (!markdown?.trim()) return '';
	return marked.parse(markdown, { breaks: true, gfm: true, renderer }) as string;
}
