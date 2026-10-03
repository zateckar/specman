/**
 * A mock-up: one page showing how the application might look.
 *
 * The document says what the application must do, in words. Someone who
 * commissions software reacts to a screen far more readily than to a chapter —
 * a list they would work from, a form with the fields they named — so the
 * assistant can make one clickable page from the document, with invented sample
 * data, as a prompt for "that is not how we do it".
 *
 * This module decides what the model is given and asked — the screens first,
 * then the page — which reply is a page, what is added to the page before it is
 * kept, and what every response carrying one tells the browser. The job that
 * makes the calls is `server/mockups.ts`.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

/** A chapter as this module needs to see it. */
export interface MockupChapter {
	key: string;
	title: string;
	applicable: number;
	parent_key: string;
	content_md: string;
}

/** A rule as this module needs to see it. */
export interface MockupRule {
	chapter_key: string;
	statement: string;
	scope: string;
}

/** Prose per chapter: enough for the screens and fields it describes. */
export const PROSE_LIMIT = 3000;
/** Prose across the document, shared out when there are many chapters. */
export const DOCUMENT_PROSE_LIMIT = 45000;
/** Never less than this per chapter, however many there are. */
const PROSE_FLOOR = 600;
/** First-version rules per chapter. */
export const RULES_PER_CHAPTER = 20;

function clip(text: string, limit: number): string {
	if (text.length <= limit) return text;
	const cut = text.slice(0, limit);
	const space = cut.search(/\s\S*$/);
	return `${(space > limit / 2 ? cut.slice(0, space) : cut).trimEnd()} […]`;
}

/**
 * The document as the mock-up call sees it, or '' when nothing is written yet.
 *
 * Every chapter that applies, in the order given — reading order, as
 * `projectChapters` returns it — with its prose clipped and its rules for the
 * first version. No chapter key is privileged, so a template an administrator
 * changed is read the same way. Set-aside chapters and rules for later or out of
 * scope are left out: what the call is not given, it is less likely to show as
 * the first version. A document of many chapters shares the prose out, so the
 * request stays a size every backend takes.
 */
export function mockupDocument(
	project: { name: string; description: string },
	chapters: MockupChapter[],
	rules: MockupRule[]
): string {
	const inScope = chapters.filter((c) => c.applicable !== 0);
	const written = inScope.filter((c) => c.content_md.trim()).length;
	if (written === 0) return '';
	const limit = Math.min(PROSE_LIMIT, Math.max(PROSE_FLOOR, Math.floor(DOCUMENT_PROSE_LIMIT / written)));

	const parts = inScope
		.map((chapter) => {
			const prose = clip(chapter.content_md.trim(), limit);
			const own = rules
				.filter((r) => r.chapter_key === chapter.key && r.scope === 'now' && r.statement.trim())
				.slice(0, RULES_PER_CHAPTER)
				.map((r) => `- ${r.statement.trim()}`);
			if (!prose && own.length === 0) return '';
			return [
				`${chapter.parent_key ? '###' : '##'} ${chapter.title}`,
				prose,
				own.length > 0 ? `Must be true in the first version:\n${own.join('\n')}` : ''
			]
				.filter(Boolean)
				.join('\n\n');
		})
		.filter(Boolean);

	return [`# ${project.name}`, project.description.trim(), ...parts].filter(Boolean).join('\n\n');
}

/** The screens decided, as the page call is given them; a longer list is clipped. */
export const SCREENS_LIMIT = 8000;

/**
 * The first of two calls: which screens the page shows, decided before it is
 * written. Asked for the screens and the page at once, the served model spent
 * the whole of 32000 tokens deliberating and wrote no page at all — the lesson
 * the diagram had already paid for. Deciding is small; writing from a decided
 * list is nearly mechanical.
 */
export function buildScreensPrompt(): string {
	return `You are Specman, a design assistant at Škoda Auto. A colleague is writing the design
document for an application they need, and a clickable mock-up of it is about to be made: one
page they can click through to see how it might look. Another step writes the page. Your part
is to decide what it shows, from the document you are given.

List the screens, at most six, in the order someone would meet them. For each:
- its name, as the navigation would show it;
- who uses it, if the document names groups of users who see or may do different things;
- what is on it: the lists with their columns, the forms with their fields and what each
  must hold, the buttons and what each does when clicked;
- the sample records it shows, invented and plausible, never real people's details.

Then, if the document names such groups, one line naming them, for a "viewing as" switcher.

Only what the document describes for the first version. Where it does not say how something
looks, choose what a sensible designer would. Every name and label in the language the
document is written in.

Write the list and nothing else, between <screens> and </screens>, in plain short lines: no
HTML and no code. Keep it under 700 words.`;
}

/**
 * The screens in a reply, or null if there are none. Between the tags when they
 * are there; the whole reply when they are not, since a list without its tags is
 * still the list; to the end when the closing tag never came.
 */
export function extractScreens(reply: string): string | null {
	let text = reply.replace(/\r\n?/g, '\n');
	const open = /<screens>/i.exec(text);
	if (open) {
		text = text.slice(open.index + open[0].length);
		const close = text.toLowerCase().lastIndexOf('</screens>');
		if (close >= 0) text = text.slice(0, close);
	}
	text = text.trim();
	return text ? clip(text, SCREENS_LIMIT) : null;
}

/**
 * The system prompt for the page. Everything here that must hold is also
 * enforced where the reply is read or served: a page is cut out of whatever
 * surrounds it, one that loads from outside is asked for again, storage and
 * dialogs are given stand-ins that work in the sandbox, and the policy blocks
 * the network whatever the page tries.
 *
 * `planned`: the screens were decided by the first call and follow the
 * document, so this call is told to build them rather than decide again.
 */
export function buildMockupPrompt(brief = false, planned = false): string {
	return `You are Specman, a design assistant at Škoda Auto. A colleague is writing the design
document for an application they need, and wants to see how it might look before anyone
builds it. From the document you are given, make a clickable mock-up: one page they can open
in a browser and click through.

WHAT TO MAKE
- One complete HTML document, from <!DOCTYPE html> to </html>, with all CSS in one <style>
  element in the head and all JavaScript in one <script> element at the end of the body.
- Plain HTML, CSS and JavaScript that runs as it is: no framework, no library, no build step,
  no modules or imports.
- Nothing from outside the file: no external script, stylesheet, font, image or icon set, no
  CDN, no fetch or other network call. The page is shown where the network is blocked, so
  anything loaded from elsewhere will not appear. Use the system font stack, draw icons as
  inline SVG or plain characters, and show pictures as coloured shapes.
- Keep every change in memory, in plain JavaScript variables. Do not use localStorage,
  sessionStorage, cookies or IndexedDB; they are not available where it is shown.
- The main screens the document describes, reachable from a navigation bar or menu. Switch
  between screens in JavaScript by showing and hiding sections; never load another page. A
  link that leads nowhere has href="#" and does nothing.
- If the document names groups of users who see or may do different things, a small
  "viewing as" switcher at the top that changes what is shown.
- Sample data you invent: plausible names, dates, numbers and states, three to six rows in a
  list. Never real people's details.
- Compact: around 20 to 30 KB in all, with short CSS and one small script that shows and hides
  the screens. A page this size is written in a few minutes; a larger one does not finish.
- Forms check what the document's rules say they must; submitting one shows a short
  confirmation on the page and goes nowhere (call preventDefault).
- A clean, restrained look for an internal company tool: a light neutral background, one
  accent colour, clear type, generous spacing. It must work at a phone's width as well as a
  laptop's.
- Accessible: a label for every input, real buttons, enough contrast, everything reachable
  with the keyboard.

WHAT TO SHOW
${
		planned
			? `- The screens listed after the document. They are already decided: build each as it is
  described, in that order, with that sample data, rather than deciding them again.`
			: `- Only what the document describes for the first version. Where it does not say how
  something looks, choose what a sensible designer would.
- The main screens, not every corner of the application: it should stay small enough to
  read.`
	}
- Every word on the page in the language the document is written in.

Write the HTML and nothing else: no explanation before or after it, no code fence.${
		planned
			? ` Start
writing it at once; there is nothing left to decide, so do not draft it in your head first.`
			: ''
	}${
		brief
			? `

YOUR LAST ATTEMPT COULD NOT BE USED: it did not finish, or it loaded something from outside
the file, which cannot load where it is shown. Make it smaller this time — the three or four
most important screens, a few rows of sample data, compact CSS — and put every style and
script inside the file. Start with <!DOCTYPE html> at once.`
			: ''
	}`;
}

/** The first call's user turn: the document, then the request. */
export function screensRequest(document: string): string {
	return `${document}\n\n---\n\nDecide the screens of the mock-up of this application now.`;
}

/** The page call's user turn: the document, the screens when they were decided, then the request. */
export function mockupRequest(document: string, screens: string | null = null): string {
	if (!screens) return `${document}\n\n---\n\nMake the mock-up of this application now.`;
	return `${document}\n\n---\n\nThe screens of the mock-up, already decided:\n\n${screens}\n\n---\n\nMake the mock-up of this application now, showing these screens.`;
}

/* ------------------------------------------------------------ the reply */

/**
 * The page in a reply, or null if there is none.
 *
 * From the doctype — or the opening tag, when there is no doctype — to the last
 * closing tag. A doctype at the start of a line is preferred: one mentioned in
 * passing in a sentence before the page would otherwise put that sentence at the
 * top of it. With no closing tag, which HTML permits, the page ends after its
 * body, or else at a closing code fence: talk after it would show as page text.
 * A page with no body is not a page.
 */
export function extractMockup(reply: string): string | null {
	const text = reply.replace(/\r\n?/g, '\n');
	const starts = [/^[ \t]*<!doctype\s+html/im, /^[ \t]*<html[\s>]/im, /<!doctype\s+html/i, /<html[\s>]/i];
	let start = -1;
	for (const pattern of starts) {
		const found = pattern.exec(text);
		if (found) {
			start = found.index + (found[0].length - found[0].trimStart().length);
			break;
		}
	}
	if (start < 0) return null;

	let page = text.slice(start);
	const lower = page.toLowerCase();
	const end = lower.lastIndexOf('</html>');
	const body = lower.lastIndexOf('</body>');
	if (end >= 0) {
		page = page.slice(0, end + '</html>'.length);
	} else if (body >= 0) {
		page = `${page.slice(0, body + '</body>'.length)}\n</html>`;
	} else {
		const fence = page.search(/\n[ \t]*```/);
		if (fence >= 0) page = page.slice(0, fence);
	}
	page = page.trim();
	return /<body[\s>]/i.test(page) ? page : null;
}

/** Inside the file: an address that carries its content with it. */
const inside = (address: string) => /^(?:data|blob):/i.test(address.trim());
/** A typeface: missing, the page falls back to the system's and is none the worse. */
const typeface = (address: string) => /font/i.test(address);

/**
 * Scripts and stylesheets the page loads from anywhere but itself.
 *
 * The policy blocks every one of them, so a page built on a CDN shows unstyled.
 * A pattern over `src`, `href` and `@import`: an address built at run time is
 * not seen, and is blocked all the same. Images and typefaces are not counted —
 * a page missing them is still usable, and is not worth minutes of a retry.
 */
export function loadsFromOutside(html: string): string[] {
	const found = new Set<string>();
	const note = (address: string) => {
		if (!inside(address) && !typeface(address)) found.add(address);
	};
	for (const match of html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*["']?([^"'\s>]+)/gi)) note(match[1]);
	for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
		if (!/\brel\s*=\s*["']?[^"'>]*\bstylesheet\b/i.test(match[0])) continue;
		const href = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(match[0]);
		if (href) note(href[1]);
	}
	for (const match of html.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi)) note(match[1]);
	return [...found];
}

/** Whether a reply is worth the one retry: no page, or one that cannot show as written. */
export function worthAnotherTry(page: string | null): boolean {
	return page === null || loadsFromOutside(page).length > 0;
}

/**
 * The page to keep of two attempts. The second only when the first had none, or
 * it loads less from outside: asked to be smaller, it is also likely to be less,
 * and a fuller page that is partly unstyled may still be the better of the two.
 */
export function betterMockup(first: string | null, second: string | null): string | null {
	if (!second) return first;
	if (!first) return second;
	return loadsFromOutside(second).length < loadsFromOutside(first).length ? second : first;
}

/* ---------------------------------------------------------- serving it */

/**
 * The sandbox the frame and the response both apply. Scripts, so it can be
 * clicked through; forms, because without them a submission is dropped before
 * the page's own handler sees it. Never same-origin, top navigation, popups,
 * modal dialogs or downloads: a `prompt()` would ask for something under
 * Specman's name.
 */
export const MOCKUP_SANDBOX = 'allow-scripts allow-forms';

/** What the page may load and send: nothing but itself. */
const CONTENT_DIRECTIVES = [
	"default-src 'none'",
	"script-src 'unsafe-inline'",
	"style-src 'unsafe-inline'",
	'img-src data: blob:',
	'font-src data:',
	'media-src data: blob:',
	"connect-src 'none'",
	"form-action 'none'",
	"base-uri 'none'"
];

/**
 * The policy every response carrying a mock-up sends.
 *
 * The page is code nobody has read, written from a document anyone working on
 * it can write. Sandboxed, it has an origin of its own — no cookie, storage or
 * page of Specman's — and with nothing allowed but itself, it can fetch
 * nothing, load nothing from elsewhere and send no form. Only Specman's own
 * pages may frame it.
 */
export const MOCKUP_POLICY = [`sandbox ${MOCKUP_SANDBOX}`, ...CONTENT_DIRECTIVES, "frame-ancestors 'self'"].join('; ');

/**
 * The same, as the page carries it inside itself, for the downloaded file:
 * opened from a disk or an email, no response header comes with it. A policy in
 * the page can only narrow what a header allows, so the page cannot loosen it.
 * `sandbox` and `frame-ancestors` have no effect there.
 */
export const MOCKUP_FILE_POLICY = CONTENT_DIRECTIVES.join('; ');

/**
 * Stand-ins for what an origin of its own takes away. Storage and cookies throw
 * in the sandbox, and one throw as a page starts leaves the whole mock-up dead,
 * so they fall back to memory. Dialogs are refused there and would show under
 * Specman's name in a tab of its own, so they become a note on the page; a
 * question is answered yes, so the mock-up goes on.
 */
const STAND_INS = `(function () {
  function memory() {
    var items = {};
    return {
      getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(items, k) ? items[k] : null; },
      setItem: function (k, v) { items[String(k)] = String(v); },
      removeItem: function (k) { delete items[String(k)]; },
      clear: function () { items = {}; },
      key: function (i) { var keys = Object.keys(items); return i < keys.length ? keys[i] : null; },
      get length() { return Object.keys(items).length; }
    };
  }
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    try { window[name].getItem('specman'); return; } catch (e) {}
    try { Object.defineProperty(window, name, { value: memory(), configurable: true }); } catch (e) {}
  });
  try { void document.cookie; } catch (e) {
    var jar = {};
    try {
      Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: function () { return Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; '); },
        set: function (v) {
          var pair = String(v).split(';')[0], at = pair.indexOf('=');
          if (at > 0) jar[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
        }
      });
    } catch (e2) {}
  }
  function say(message) {
    var note = document.createElement('div');
    note.setAttribute('role', 'status');
    note.textContent = message === undefined ? '' : String(message);
    note.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;' +
      'max-width:min(90vw,480px);padding:10px 16px;border-radius:8px;background:#1f2723;color:#fff;' +
      'font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25)';
    (document.body || document.documentElement).appendChild(note);
    setTimeout(function () { note.remove(); }, 3500);
  }
  window.alert = function (message) { say(message); };
  window.confirm = function (message) { say(message); return true; };
  window.prompt = function (message, value) { say(message); return value === undefined ? '' : String(value); };
})();`;

/**
 * The page as it is kept, shown and downloaded.
 *
 * A doctype, so it is never drawn in quirks mode; then a comment saying what it
 * is, because a downloaded file is passed on without the page that explained
 * it; then, first in the head, the encoding for Czech text opened from a disk,
 * the policy for the file, a viewport if the page has none, and the stand-ins,
 * ahead of any script of the page's own. Nothing in the name can end the
 * comment early. The doctype stays first: some browsers have read a comment
 * ahead of it as a reason for quirks mode.
 */
export function prepareMockup(html: string, about: { name: string; madeOn: string }): string {
	let page = html.trim();
	if (!/^<!doctype/i.test(page)) page = `<!DOCTYPE html>\n${page}`;
	const doctype = /^<!doctype[^>]*>/i.exec(page)![0];
	let rest = page.slice(doctype.length).trimStart();

	const name = about.name.replace(/-{2,}/g, '-').replace(/[<>]/g, '').trim();
	const comment = `<!--
  A mock-up of "${name}", made by Specman's assistant from its design document on ${about.madeOn}.
  One way the application could look, with invented sample data. The design document, not
  this page, is what to build from. The first lines of the head were added by Specman so it
  works the same wherever it is opened.
-->`;

	const additions = [
		'<meta charset="utf-8">',
		`<meta http-equiv="Content-Security-Policy" content="${MOCKUP_FILE_POLICY}">`,
		...(/<meta\b[^>]*\bname\s*=\s*["']?viewport/i.test(rest)
			? []
			: ['<meta name="viewport" content="width=device-width, initial-scale=1">']),
		`<script>${STAND_INS}</script>`
	].join('\n');

	const head = /<head\b[^>]*>/i.exec(rest);
	const opening = /<html\b[^>]*>/i.exec(rest);
	if (head) {
		const at = head.index + head[0].length;
		rest = `${rest.slice(0, at)}\n${additions}${rest.slice(at)}`;
	} else if (opening) {
		const at = opening.index + opening[0].length;
		rest = `${rest.slice(0, at)}\n<head>\n${additions}\n</head>${rest.slice(at)}`;
	} else {
		rest = `<head>\n${additions}\n</head>\n${rest}`;
	}
	return `${doctype}\n${comment}\n${rest}`;
}

/** Headers for a response carrying a mock-up, shown or downloaded. */
export function mockupHeaders(): Record<string, string> {
	return {
		'content-type': 'text/html; charset=utf-8',
		'content-security-policy': MOCKUP_POLICY,
		'x-frame-options': 'SAMEORIGIN',
		'x-content-type-options': 'nosniff',
		'referrer-policy': 'no-referrer',
		'cache-control': 'no-store'
	};
}

/**
 * Whether a request for the mock-up comes from its frame. A browser that says
 * where the response will be shown and says anything else — a tab of its own —
 * is refused: there the sandbox would rest on the header alone, and a proxy that
 * dropped it would leave the model's script running as Specman with the
 * colleague's session. A browser that says nothing is answered, with the header.
 */
export function forTheFrame(destination: string | null): boolean {
	return destination === null || destination === '' || destination === 'iframe';
}

/** The downloaded file's name. */
export function mockupFileName(slug: string): string {
	return `${slug.replace(/[^a-z0-9-]/gi, '') || 'application'}-mock-up.html`;
}
