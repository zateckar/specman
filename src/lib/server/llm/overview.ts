/**
 * The overview: what the application is, why it is worth doing, how hard it is,
 * and what it would take to build and to run.
 *
 * The colleague who commissions an application has to get it approved and
 * funded before anyone builds it, and management asks first what the document
 * never says: what is it, why bother, how hard, how much. So the assistant
 * writes those from the document, as the diagram and the mock-up are made.
 *
 * The assistant judges and the code counts. The reply carries the pitch, the
 * business case, two ratings with their reasons, the work in person-days per
 * part, and which services of the reference architecture it needs at which size
 * — and no money. Every figure is calculated here from those judgements and the
 * rates and prices below, so the same judgements always give the same figures,
 * a total always adds up, and every assumption can be printed beside it. A model
 * asked for a total writes a plausible number; it does not add.
 *
 * This module decides what the call is given and asked, reads the reply, settles
 * the services against the reference architecture, calculates the figures and
 * renders the report as a file. The job that makes the call is
 * `server/overviews.ts`.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

export type Level = 'low' | 'medium' | 'high';
export type Size = 's' | 'm' | 'l';
/** How far the application reaches, as the triage recorded it. See `profile.ts`. */
export type Reach = 'team' | 'company' | 'external';

const LEVELS: readonly Level[] = ['low', 'medium', 'high'];
const SIZES: readonly Size[] = ['s', 'm', 'l'];

/* ------------------------------------------------------- what things cost */

/** A person-day of a professional team, blended across roles, in euros. */
export const DAY_RATE = 600;

/**
 * What building by hand takes besides the building, as shares of it. The
 * assistant is asked for programming and the developers' own testing only: asked
 * for everything, it left out what it forgot, differently every time.
 */
export const BY_HAND = { design: 0.12, testing: 0.25, management: 0.1 } as const;

/**
 * Building with an AI coding assistant: it works on its own for long stretches,
 * and people look in at checkpoints — to set the next task, read what it wrote,
 * and correct its course. Their time is intermittent, not a working day beside it,
 * so directing it is a small share of the building, growing with how unusual the
 * application is. Little is left to manage when most of the work is the AI's.
 * Design is smaller because the design document already exists; acceptance is
 * not, because people still do it.
 */
export const WITH_AI = {
	design: 0.08,
	directing: { low: 0.06, medium: 0.1, high: 0.15 } as Record<Level, number>,
	testing: 0.12,
	management: 0.02
} as const;

/** The AI assistant's own usage, in euros per person-day of building it replaces. */
export const AI_USAGE_PER_DAY = 40;

/** Setting up hosting, pipelines and the first deployment, by technical complexity. */
export const DEPLOYMENT_DAYS: Record<Level, number> = { low: 3, medium: 6, high: 12 };

/**
 * The same with an AI coding assistant, which writes the pipelines and the
 * infrastructure templates as well as it writes the code; people review them and
 * see the first deployment through.
 */
export const AI_DEPLOYMENT_DAYS: Record<Level, number> = { low: 1, medium: 2, high: 2 };

/** Productive days per person per week, after meetings and everything else. */
export const DAYS_PER_WEEK = 4;

/**
 * The range shown around every estimate. Wider above than below: an estimate
 * made before the design is finished is more often low than high.
 */
export const RANGE = { below: 0.8, above: 1.5 } as const;

/** Development and test environments, as a share of production's monthly cost. */
export const NON_PRODUCTION_SHARE = 0.4;

/** Support and small changes per year, as a share of building it by hand. */
export const SUPPORT_SHARE = 0.15;

/** When the prices below were taken from Azure's published list. */
export const PRICES_AS_OF = '2026-10';

/* ------------------------------------------------ the reference architecture */

/** A service of the reference architecture, priced per month at three sizes. */
export interface Service {
	key: string;
	/** As the report shows it. */
	name: string;
	/** What it is for, in plain words. */
	role: string;
	sizes: Record<Size, { sku: string; monthly: number }>;
}

const fixed = (sku: string, monthly: number): Service['sizes'] => ({
	s: { sku, monthly },
	m: { sku, monthly },
	l: { sku, monthly }
});

/**
 * Azure list prices, West Europe, pay as you go, in euros per month (730 hours),
 * read from the Azure Retail Prices API on 2026-10-03. Where it lists only a unit
 * price — per second, per token, per gigabyte — the month is worked out from the
 * use the size names. Company agreements usually pay less; the report says so.
 * Front Door and private endpoints are priced globally, not per region. The catalogue is the
 * reference architecture for an internal web application: everything the
 * assistant may choose is here, and nothing it names outside it is priced.
 */
export const CATALOGUE: Service[] = [
	{
		key: 'entra-id',
		name: 'Sign-in (Microsoft Entra ID)',
		role: 'Company sign-in, and who may do what',
		sizes: fixed('Included in the company licences', 0)
	},
	{
		key: 'app-service',
		name: 'Web hosting (Azure App Service)',
		role: 'Runs the application',
		sizes: {
			s: { sku: 'Premium v3 P0v3, one instance', monthly: 57 },
			m: { sku: 'Premium v3 P1v3, two instances', monthly: 229 },
			l: { sku: 'Premium v3 P2v3, two instances', monthly: 457 }
		}
	},
	{
		key: 'container-apps',
		name: 'Container hosting (Azure Container Apps)',
		role: 'Runs the application in containers, scaling down when idle',
		sizes: {
			s: { sku: 'Consumption, one small container in office hours', monthly: 10 },
			m: { sku: 'Consumption, two containers around the clock', monthly: 190 },
			l: { sku: 'Consumption, four containers around the clock', monthly: 390 }
		}
	},
	{
		key: 'functions',
		name: 'Background jobs (Azure Functions)',
		role: 'Scheduled and triggered work in the background',
		sizes: {
			s: { sku: 'Flex Consumption, light use', monthly: 5 },
			m: { sku: 'Flex Consumption, steady use', monthly: 40 },
			l: { sku: 'Flex Consumption, always-ready instances', monthly: 150 }
		}
	},
	{
		key: 'sql',
		name: 'Database (Azure SQL Database)',
		role: 'Keeps its records',
		sizes: {
			s: { sku: 'Standard S1, 250 GB', monthly: 26 },
			m: { sku: 'Standard S3, 250 GB', monthly: 129 },
			l: { sku: 'General Purpose, 2 vCores, 32 GB', monthly: 348 }
		}
	},
	{
		key: 'postgresql',
		name: 'Database (Azure Database for PostgreSQL)',
		role: 'Keeps its records',
		sizes: {
			s: { sku: 'Burstable B1ms, 32 GB', monthly: 17 },
			m: { sku: 'General Purpose D2ds v5, 128 GB', monthly: 151 },
			l: { sku: 'General Purpose D4ds v5 with a standby, 256 GB', monthly: 606 }
		}
	},
	{
		key: 'blob-storage',
		name: 'File storage (Azure Blob Storage)',
		role: 'Documents, pictures and exports',
		sizes: {
			s: { sku: 'Hot, locally redundant, 100 GB', monthly: 3 },
			m: { sku: 'Hot, locally redundant, 1 TB', monthly: 20 },
			l: { sku: 'Hot, zone-redundant, 5 TB', monthly: 120 }
		}
	},
	{
		key: 'service-bus',
		name: 'Messaging (Azure Service Bus)',
		role: 'Reliable hand-over of work between systems',
		sizes: {
			s: { sku: 'Standard', monthly: 9 },
			m: { sku: 'Standard, heavy use', monthly: 15 },
			l: { sku: 'Premium, one messaging unit', monthly: 600 }
		}
	},
	{
		key: 'redis',
		name: 'Cache (Azure Cache for Redis)',
		role: 'Keeps frequently read data close at hand',
		sizes: {
			s: { sku: 'Standard C0', monthly: 35 },
			m: { sku: 'Standard C1', monthly: 89 },
			l: { sku: 'Premium P1', monthly: 356 }
		}
	},
	{
		key: 'ai-search',
		name: 'Search (Azure AI Search)',
		role: 'Full-text and AI search over its content',
		sizes: {
			s: { sku: 'Basic', monthly: 65 },
			m: { sku: 'Standard S1', monthly: 216 },
			l: { sku: 'Standard S1, two replicas', monthly: 432 }
		}
	},
	{
		key: 'openai',
		name: 'AI model (Azure OpenAI)',
		role: 'Language-model features, paid per use',
		sizes: {
			s: { sku: 'A small model, light use', monthly: 10 },
			m: { sku: 'A large model, about 35 million words a month', monthly: 180 },
			l: { sku: 'A large model, about 180 million words a month', monthly: 900 }
		}
	},
	{
		key: 'api-management',
		name: 'API gateway (Azure API Management)',
		role: 'Publishes its interfaces to other systems',
		sizes: {
			s: { sku: 'Basic v2', monthly: 132 },
			m: { sku: 'Standard v2', monthly: 616 },
			l: { sku: 'Standard v2, two units', monthly: 1232 }
		}
	},
	{
		key: 'logic-apps',
		name: 'Integrations (Azure Logic Apps)',
		role: 'Connects to other systems without code',
		sizes: {
			s: { sku: 'Consumption', monthly: 15 },
			m: { sku: 'Standard WS1', monthly: 158 },
			l: { sku: 'Standard WS2', monthly: 316 }
		}
	},
	{
		key: 'front-door',
		name: 'Front door and firewall (Azure Front Door)',
		role: 'Safe access from the internet',
		sizes: {
			s: { sku: 'Standard, with light traffic', monthly: 40 },
			m: { sku: 'Premium, with managed firewall rules', monthly: 310 },
			l: { sku: 'Premium, with heavy traffic', monthly: 450 }
		}
	},
	{
		key: 'key-vault',
		name: 'Secrets (Azure Key Vault)',
		role: 'Keeps passwords and keys out of the code',
		sizes: fixed('Standard', 3)
	},
	{
		key: 'monitoring',
		name: 'Monitoring (Application Insights and Log Analytics)',
		role: 'Shows how it runs, and what went wrong',
		sizes: {
			s: { sku: 'About 5 GB of logs a month', monthly: 5 },
			m: { sku: 'About 20 GB of logs a month', monthly: 40 },
			l: { sku: 'About 60 GB of logs a month', monthly: 145 }
		}
	},
	{
		key: 'private-networking',
		name: 'Private networking (private endpoints)',
		role: 'Keeps its parts off the internet',
		sizes: {
			s: { sku: 'Three private endpoints', monthly: 19 },
			m: { sku: 'Five private endpoints', monthly: 32 },
			l: { sku: 'Eight private endpoints', monthly: 51 }
		}
	},
	{
		key: 'defender',
		name: 'Security monitoring (Microsoft Defender for Cloud)',
		role: 'Watches for attacks and weaknesses',
		sizes: {
			s: { sku: 'For the hosting and the database', monthly: 26 },
			m: { sku: 'For the hosting, the database and the storage', monthly: 49 },
			l: { sku: 'For every service', monthly: 100 }
		}
	}
];

const byKey = new Map(CATALOGUE.map((service) => [service.key, service]));

/** Counted in every application: what the reference architecture requires of all of them. */
export const BASELINE = ['entra-id', 'key-vault', 'monitoring', 'private-networking', 'defender'];
/** What runs the application. With none chosen, it would run on nothing. */
const HOSTING = ['app-service', 'container-apps', 'functions'];

/* ------------------------------------------------------------- the call */

/** The catalogue as the prompt lists it, from the same table that prices it. */
function catalogueForPrompt(): string {
	return CATALOGUE.filter((service) => service.key !== 'entra-id')
		.map((service) => {
			const sizes = SIZES.map((size) => `${size} = ${service.sizes[size].sku}`);
			const same = service.sizes.s.sku === service.sizes.l.sku;
			return `- ${service.key}: ${service.role.toLowerCase()}${same ? '' : `; ${sizes.join('; ')}`}`;
		})
		.join('\n');
}

/**
 * The system prompt. Everything here that must hold is also enforced where the
 * reply is read: a section without its closing tag is still read, a rating that
 * is missing is derived, the reference architecture's baseline is added, and no
 * money in the reply is ever used.
 */
export function buildOverviewPrompt(brief = false): string {
	return `You are Specman, a design assistant at Škoda Auto. A colleague has written, with your help,
the design document for an application they need. Before anyone builds it, they must explain
it to their management and get it approved and funded. From the document you are given,
write the overview they will take to that meeting.

It is read by managers who decide whether to fund the application, and by the colleague, who
commissions software but does not build it. Use plain words: no jargon left unexplained, no
requirement notation, no abbreviation a manager would not know.

Write these sections, each between its tags, in this order, and nothing outside them.

<pitch>
Two or three sentences: what the application is, who it is for, and what changes for them.
Something the colleague could say between two floors in a lift.
</pitch>

<business-case>
The problem today and what it costs; who benefits and how; what the application brings, as a
short list; what happens if it is not built. Under 250 words. Only what the document
supports: where it gives no numbers, say what would be measured rather than inventing them.
</business-case>

<business-complexity level="LEVEL">
Two to four short lines on why: how many groups of people and departments it involves, how
much the way they work changes, rules and approvals it must follow, personal or regulated
data.
</business-complexity>

<technical-complexity level="LEVEL">
Two to four short lines on why: the systems it connects to, how many users and how much data,
what must never fail, security, anything unusual.
</technical-complexity>

LEVEL is low, medium or high.

<work>
The work of building the first version by hand, by a professional team, one part per line,
written as: part | person-days
Count programming and the developers' own testing only. Design, testing and acceptance,
project management and setting up hosting are added by Specman, so do not list them. Six to
twelve parts, in whole or half days.
</work>

<azure>
The Azure services the first version needs, one per line, written as: service | size | why
Choose each service from this list, and its size as s, m or l:
${catalogueForPrompt()}
Sign-in, secrets, monitoring, private networking and security monitoring are always counted;
give monitoring a size. Choose the smallest size the document supports. A service it needs
that is not in the list may have a line of its own, written as: name | - | why
</azure>

<assumptions>
Up to five short lines: what you assumed, where the document says nothing, that changes these
estimates.
</assumptions>

Write no money, prices or totals: Specman calculates them from your estimates.
Write every word in the language the document is written in, except the tags, the levels, and
the service names and sizes in <azure>, which stay exactly as given.${
		brief
			? `

YOUR LAST ATTEMPT COULD NOT BE USED: it did not finish, or it had no pitch or no work list.
Keep every section short this time, and start with <pitch> at once.`
			: ''
	}`;
}

/** The call's user turn: the document, what the triage said about it, then the request. */
export function overviewRequest(document: string, profile: string, change = false): string {
	const kind = change ? ' It changes an application that already exists.' : '';
	return `${document}\n\n---\n\nThis application is ${profile}.${kind}\n\nWrite the overview of this application now.`;
}

/* ------------------------------------------------------------ the reply */

/** What the reply said, read but not yet settled. */
export interface OverviewReply {
	pitch: string;
	businessCase: string;
	businessComplexity: { level: Level | null; reasons: string };
	technicalComplexity: { level: Level | null; reasons: string };
	work: Array<{ name: string; days: number }>;
	services: Array<{ key: string; size: Size; why: string }>;
	/** Services the reply named that are not in the catalogue. */
	unpriced: string[];
	assumptions: string;
}

const TAGS = [
	'pitch',
	'business-case',
	'business-complexity',
	'technical-complexity',
	'work',
	'azure',
	'assumptions'
];

/**
 * A section's attributes and text. Without its closing tag — the end of a long
 * instruction is what these models drop — it runs to the next section's opening
 * tag, or the end of the reply.
 */
function section(reply: string, name: string): { attributes: string; body: string } | null {
	const open = new RegExp(`<${name}(\\s[^>]*)?>`, 'i').exec(reply);
	if (!open) return null;
	const rest = reply.slice(open.index + open[0].length);
	let end = rest.search(new RegExp(`</${name}\\s*>`, 'i'));
	if (end < 0) {
		const next = rest.search(new RegExp(`<(?:${TAGS.join('|')})[\\s>]`, 'i'));
		end = next >= 0 ? next : rest.length;
	}
	return { attributes: open[1] ?? '', body: rest.slice(0, end).trim() };
}

/** A rating: from its attribute, or a first line that names it. */
function rating(found: { attributes: string; body: string } | null): { level: Level | null; reasons: string } {
	if (!found) return { level: null, reasons: '' };
	const attribute = /\blevel\s*=\s*["']?(low|medium|high)\b/i.exec(found.attributes);
	if (attribute) return { level: attribute[1].toLowerCase() as Level, reasons: found.body };
	const lead = /^\s*(?:level\s*:?\s*)?\**(low|medium|high)\**\s*(?:[.:–-]\s*|\n|$)/i.exec(found.body);
	if (lead) return { level: lead[1].toLowerCase() as Level, reasons: found.body.slice(lead[0].length).trim() };
	return { level: null, reasons: found.body };
}

/** Lines of a list section, without bullets, numbering or emphasis. */
function lines(body: string): string[] {
	return body
		.split('\n')
		.map((line) =>
			line
				.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
				.replace(/\*\*|__|`/g, '')
				.trim()
		)
		.filter((line) => line && !/^\|?[\s:|-]+\|?$/.test(line));
}

/** Person-days in a cell: the number, or the middle of a range. */
function readDays(text: string): number {
	const numbers = [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(',', '.')));
	if (numbers.length === 0) return NaN;
	if (numbers.length >= 2 && /\d\s*(?:–|-|to|až)\s*\d/i.test(text)) return (numbers[0] + numbers[1]) / 2;
	return numbers[0];
}

/** The most person-days one part may claim; a larger figure is a slip, not an estimate. */
export const MAX_PART_DAYS = 250;
/** Parts kept from one reply. */
export const MAX_PARTS = 20;

/** One part of the work: `part | days`, or `part: 5 days`. Null for anything else. */
function readPart(line: string): { name: string; days: number } | null {
	const cells = line
		.split('|')
		.map((cell) => cell.trim())
		.filter(Boolean);
	let name: string;
	let days: number;
	if (cells.length >= 2) {
		name = cells[0];
		days = readDays(cells.slice(1).join(' '));
	} else {
		const match = /^(.*?\D)[\s:–-]+(\d[\d.,]*(?:\s*(?:–|-|to|až)\s*\d[\d.,]*)?)\s*[a-zá-ž.\s-]*$/i.exec(line);
		if (!match) return null;
		name = match[1];
		days = readDays(match[2]);
	}
	name = name.replace(/[:–-]\s*$/, '').trim().slice(0, 120);
	if (!name || !Number.isFinite(days) || days <= 0) return null;
	return { name, days: Math.min(MAX_PART_DAYS, Math.max(0.5, Math.round(days * 2) / 2)) };
}

function readSize(text: string): Size | null {
	const match = /^(s|m|l|small|medium|large)\b/i.exec(text.trim());
	return match ? (match[1][0].toLowerCase() as Size) : null;
}

/**
 * The overview in a reply, or null when it is not one. A reply with no pitch or
 * no work is not: the pitch is what the page leads with, and without the work
 * there is nothing to count.
 */
export function extractOverview(reply: string): OverviewReply | null {
	const text = reply.replace(/\r\n?/g, '\n');
	const pitch = section(text, 'pitch')?.body ?? '';
	const work = lines(section(text, 'work')?.body ?? '')
		.map(readPart)
		.filter((part): part is { name: string; days: number } => part !== null)
		.slice(0, MAX_PARTS);
	if (!pitch || work.length === 0) return null;

	const services: OverviewReply['services'] = [];
	const unpriced: string[] = [];
	for (const line of lines(section(text, 'azure')?.body ?? '')) {
		const [first = '', second = '', ...rest] = line.split('|').map((cell) => cell.trim());
		const key = first.toLowerCase().replace(/\s+/g, '-');
		if (!key) continue;
		if (byKey.has(key)) {
			services.push({ key, size: readSize(second) ?? 's', why: rest.join(' | ').trim().slice(0, 300) });
		} else if (!/^(?:service|name)$/i.test(first) && unpriced.length < 8) {
			unpriced.push(first.slice(0, 80));
		}
	}

	return {
		pitch,
		businessCase: section(text, 'business-case')?.body ?? '',
		businessComplexity: rating(section(text, 'business-complexity')),
		technicalComplexity: rating(section(text, 'technical-complexity')),
		work,
		services,
		unpriced: [...new Set(unpriced)],
		assumptions: section(text, 'assumptions')?.body ?? ''
	};
}

/* ------------------------------------------------------------ settling */

/** An overview as it is kept: every judgement made, every service settled. */
export interface Overview {
	pitch: string;
	businessCase: string;
	businessComplexity: { level: Level; reasons: string };
	technicalComplexity: { level: Level; reasons: string };
	work: Array<{ name: string; days: number }>;
	services: Array<{ key: string; size: Size; why: string }>;
	unpriced: string[];
	/** The assistant's own assumptions. */
	assumptions: string;
	/** What Specman decided where the reply left something out, in words. */
	settled: string[];
}

const larger = (a: Size, b: Size) => (SIZES.indexOf(a) >= SIZES.indexOf(b) ? a : b);
const buildDays = (work: Array<{ days: number }>) => work.reduce((sum, part) => sum + part.days, 0);

/**
 * Settle a reply against the reference architecture.
 *
 * What every application needs is counted whether the reply named it or not; an
 * application people outside the company reach gets a front door with a
 * firewall; one with nothing chosen to run it gets App Service. A rating the
 * reply left out is derived — the technical one from the size of the work, the
 * business one from how far the application reaches — and every such decision is
 * said in words, so the report never passes off Specman's guess as the
 * assistant's judgement.
 */
export function settleOverview(reply: OverviewReply, context: { reach: Reach }): Overview {
	const settled: string[] = [];
	const days = buildDays(reply.work);

	let technical = reply.technicalComplexity.level;
	if (!technical) {
		technical = days < 25 ? 'low' : days < 90 ? 'medium' : 'high';
		settled.push('The assistant gave no technical rating, so it is derived from the size of the work.');
	}
	let business = reply.businessComplexity.level;
	if (!business) {
		business = context.reach === 'team' ? 'low' : context.reach === 'company' ? 'medium' : 'high';
		settled.push('The assistant gave no business rating, so it is derived from how far the application reaches.');
	}

	const chosen = new Map<string, { key: string; size: Size; why: string }>();
	for (const service of reply.services) {
		const before = chosen.get(service.key);
		chosen.set(service.key, before ? { ...before, size: larger(before.size, service.size) } : service);
	}
	if (!HOSTING.some((key) => chosen.has(key))) {
		chosen.set('app-service', { key: 'app-service', size: context.reach === 'team' ? 's' : 'm', why: '' });
		settled.push('No hosting was chosen, so App Service is counted.');
	}
	if (context.reach === 'external' && !chosen.has('front-door')) {
		chosen.set('front-door', { key: 'front-door', size: 'm', why: '' });
		settled.push('People outside the company use it, so a front door with a firewall is counted.');
	}
	for (const key of BASELINE) {
		if (!chosen.has(key)) chosen.set(key, { key, size: technical === 'high' ? 'm' : 's', why: '' });
	}

	return {
		pitch: reply.pitch,
		businessCase: reply.businessCase,
		businessComplexity: { level: business, reasons: reply.businessComplexity.reasons },
		technicalComplexity: { level: technical, reasons: reply.technicalComplexity.reasons },
		work: reply.work,
		// In the catalogue's order, so two overviews of one application read alike.
		services: CATALOGUE.filter((service) => chosen.has(service.key)).map((service) => chosen.get(service.key)!),
		unpriced: reply.unpriced,
		assumptions: reply.assumptions,
		settled
	};
}

/**
 * An overview read back from storage. Kept as JSON written here, but read
 * defensively: a value this module would not have written is dropped rather than
 * shown, and a service that has left the catalogue is no longer priced.
 */
export function readOverview(raw: unknown): Overview | null {
	const value = (raw ?? {}) as Record<string, unknown>;
	const text = (v: unknown) => (typeof v === 'string' ? v : '');
	const level = (v: unknown): Level => (LEVELS.includes(v as Level) ? (v as Level) : 'medium');
	const rated = (v: unknown) => {
		const r = (v ?? {}) as Record<string, unknown>;
		return { level: level(r.level), reasons: text(r.reasons) };
	};
	const list = (v: unknown) => (Array.isArray(v) ? v : []);
	const work = list(value.work)
		.map((p) => p as { name?: unknown; days?: unknown })
		.filter((p) => typeof p.name === 'string' && typeof p.days === 'number' && p.days > 0)
		.map((p) => ({ name: p.name as string, days: p.days as number }));
	const pitch = text(value.pitch);
	if (!pitch || work.length === 0) return null;
	return {
		pitch,
		businessCase: text(value.businessCase),
		businessComplexity: rated(value.businessComplexity),
		technicalComplexity: rated(value.technicalComplexity),
		work,
		services: list(value.services)
			.map((s) => s as { key?: unknown; size?: unknown; why?: unknown })
			.filter((s) => byKey.has(text(s.key)) && SIZES.includes(s.size as Size))
			.map((s) => ({ key: s.key as string, size: s.size as Size, why: text(s.why) })),
		unpriced: list(value.unpriced).filter((n): n is string => typeof n === 'string'),
		assumptions: text(value.assumptions),
		settled: list(value.settled).filter((n): n is string => typeof n === 'string')
	};
}

/* ------------------------------------------------------------ the figures */

/** Text as the report shows it: paragraphs and lists, never markup. */
export type Block = { kind: 'paragraph'; text: string } | { kind: 'list'; items: string[] };

/**
 * Text from the reply as paragraphs and lists. Each line is its own paragraph:
 * the models do not wrap their lines, and a line break they write is meant.
 * `asList` makes every line an item, for sections asked for as short lines.
 * Headings and emphasis are dropped rather than rendered: the report's own
 * headings say what each part is.
 */
export function toBlocks(text: string, asList = false): Block[] {
	const blocks: Block[] = [];
	let list: string[] = [];
	const flush = () => {
		if (list.length > 0) blocks.push({ kind: 'list', items: list });
		list = [];
	};
	for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
		const line = raw
			.replace(/^\s*#+\s*/, '')
			.replace(/\*\*|__|`/g, '')
			.trim();
		const item = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
		if (!line) {
			if (!asList) flush();
		} else if (item || asList) {
			list.push(item ? item[1] : line);
		} else {
			flush();
			blocks.push({ kind: 'paragraph', text: line });
		}
	}
	flush();
	// One short line alone reads as a sentence, not a list of one.
	if (asList && blocks.length === 1 && blocks[0].kind === 'list' && blocks[0].items.length === 1) {
		return [{ kind: 'paragraph', text: blocks[0].items[0] }];
	}
	return blocks;
}

const euroFormat = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

/** Euros as the report shows them, in whole euros. */
export function euros(amount: number): string {
	return euroFormat.format(amount);
}

/** An estimate is shown to the thousand above ten thousand, to the hundred below. */
function roundMoney(amount: number): number {
	const step = amount >= 10_000 ? 1000 : 100;
	return Math.round(amount / step) * step;
}

export interface Row {
	label: string;
	days: number;
}

export interface Route {
	rows: Row[];
	/** Person-days, the sum of the rows as shown. */
	days: number;
	daysLow: number;
	daysHigh: number;
	/** People's time at the day rate, plus the AI assistant's usage on that route. */
	cost: number;
	costLow: number;
	costHigh: number;
	/** The AI assistant's usage, on the AI route; zero by hand. */
	usage: number;
	people: number;
	weeks: number;
}

const LEVEL_NAME: Record<Level, string> = { low: 'Low', medium: 'Medium', high: 'High' };

/**
 * Half days, never less than half a day for work that exists, so the rows add up
 * to the total shown. Whole days rounded every small row up to a day, which
 * inflated the AI route most, because its rows are the small ones.
 */
const halfDays = (days: number) => (days > 0 ? Math.max(0.5, Math.round(days * 2) / 2) : 0);

function route(rows: Row[], usage: number, peopleFor: (days: number) => number): Route {
	const shown = rows.map((row) => ({ label: row.label, days: halfDays(row.days) }));
	const days = shown.reduce((sum, row) => sum + row.days, 0);
	const cost = days * DAY_RATE + usage;
	const people = peopleFor(days);
	return {
		rows: shown,
		days,
		daysLow: Math.round(days * RANGE.below),
		daysHigh: Math.round(days * RANGE.above),
		// Exact, so the headline is the table's total; only the range is rounded.
		cost,
		costLow: roundMoney(cost * RANGE.below),
		costHigh: roundMoney(cost * RANGE.above),
		usage,
		people,
		weeks: Math.max(1, Math.ceil(days / (people * DAYS_PER_WEEK)))
	};
}

/** Building it by hand: the parts, and what Specman adds to them. */
export function byHand(overview: Pick<Overview, 'work' | 'technicalComplexity'>): Route {
	const build = buildDays(overview.work);
	return route(
		[
			{ label: 'Building it', days: build },
			{ label: 'Design and analysis', days: build * BY_HAND.design },
			{ label: 'Testing and acceptance', days: build * BY_HAND.testing },
			{ label: 'Project management', days: build * BY_HAND.management },
			{ label: 'Hosting and first deployment', days: DEPLOYMENT_DAYS[overview.technicalComplexity.level] }
		],
		0,
		(days) => (days <= 40 ? 2 : days <= 120 ? 3 : days <= 300 ? 5 : 7)
	);
}

/** Building it with an AI coding assistant, people directing it and accepting its work. */
export function withAi(overview: Pick<Overview, 'work' | 'technicalComplexity'>): Route {
	const build = buildDays(overview.work);
	const level = overview.technicalComplexity.level;
	return route(
		[
			{ label: 'Directing the AI and reviewing its work', days: build * WITH_AI.directing[level] },
			{ label: 'Design and analysis', days: build * WITH_AI.design },
			{ label: 'Testing and acceptance', days: build * WITH_AI.testing },
			{ label: 'Project management', days: build * WITH_AI.management },
			{ label: 'Hosting and first deployment', days: AI_DEPLOYMENT_DAYS[level] }
		],
		build * AI_USAGE_PER_DAY,
		// One fewer than by hand, but never one alone where two would build it by hand:
		// a calendar longer than by hand would contradict the time the route saves.
		() => {
			const people = byHand(overview).people;
			return people <= 2 ? people : people - 1;
		}
	);
}

export interface Running {
	services: Array<{ name: string; role: string; sku: string; why: string; monthly: number }>;
	production: number;
	nonProduction: number;
	monthly: number;
	yearly: number;
	/** People: support and small changes, per year. */
	support: number;
}

/** What it costs to keep running, from the settled services and the cost of building it. */
export function running(overview: Pick<Overview, 'services' | 'work' | 'technicalComplexity'>): Running {
	const services = overview.services
		.filter((chosen) => byKey.has(chosen.key))
		.map((chosen) => {
			const service = byKey.get(chosen.key)!;
			const size = service.sizes[chosen.size];
			return { name: service.name, role: service.role, sku: size.sku, why: chosen.why, monthly: size.monthly };
		});
	const production = services.reduce((sum, service) => sum + service.monthly, 0);
	const nonProduction = Math.round(production * NON_PRODUCTION_SHARE);
	const monthly = production + nonProduction;
	return {
		services,
		production,
		nonProduction,
		monthly,
		yearly: monthly * 12,
		support: roundMoney(byHand(overview).cost * SUPPORT_SHARE)
	};
}

/** Every figure's basis, in words, printed beside the figures. */
export function basis(technical: Level): string[] {
	const percent = (share: number) => `${Math.round(share * 100)}%`;
	return [
		`People's time is costed at ${euros(DAY_RATE)} a person-day, a blended rate for a professional team.`,
		`The assistant estimated the building: programming and the developers' own testing. Specman adds design and analysis (${percent(BY_HAND.design)} of it), testing and acceptance (${percent(BY_HAND.testing)}), project management (${percent(BY_HAND.management)}), and ${DEPLOYMENT_DAYS[technical]} days to set up hosting and deploy, for ${technical} technical complexity.`,
		`With an AI coding assistant, it writes the code and people look in at checkpoints to direct it and review its work, and accept it: ${percent(WITH_AI.directing[technical])} of the building for directing and reviewing at this complexity, because their time is intermittent, ${percent(WITH_AI.design)} for design, ${percent(WITH_AI.testing)} for testing and acceptance, ${percent(WITH_AI.management)} for management, ${AI_DEPLOYMENT_DAYS[technical]} days to set up hosting because it writes the pipelines and infrastructure templates too, plus ${euros(AI_USAGE_PER_DAY)} of AI usage for each day of building it replaces.`,
		`Each range runs from ${percent(1 - RANGE.below)} below to ${percent(RANGE.above - 1)} above, because estimates made before the design is finished are more often low than high. Calendar time assumes ${DAYS_PER_WEEK} productive days a person a week.`,
		`Azure prices are list prices for West Europe, pay as you go, as of ${PRICES_AS_OF}; company agreements usually pay less. Development and test environments are counted at ${percent(NON_PRODUCTION_SHARE)} of production.`,
		`Support and small changes are counted at ${percent(SUPPORT_SHARE)} of the cost of building it by hand, each year.`
	];
}

export interface Share {
	label: string;
	/** Whole per cent; the shares of one report add up to exactly 100. */
	percent: number;
}

/**
 * Each part's share of the building, so its size reads without person-days, which
 * a reader adds up against the totals and argues with. Rounded by the largest
 * remainder, so the column adds up to 100 rather than 99 or 101; a part too small
 * to earn a whole per cent shows as under one.
 */
export function shareOfWork(parts: Array<{ name: string; days: number }>): Share[] {
	const total = parts.reduce((sum, part) => sum + part.days, 0);
	if (total <= 0) return parts.map((part) => ({ label: part.name, percent: 0 }));
	const exact = parts.map((part) => (part.days / total) * 100);
	const shares = exact.map(Math.floor);
	let left = 100 - shares.reduce((sum, share) => sum + share, 0);
	// Earlier parts first among equal remainders, so the result does not depend on sort stability.
	const order = exact
		.map((value, index) => ({ index, rest: value - Math.floor(value) }))
		.sort((a, b) => b.rest - a.rest || a.index - b.index);
	for (const { index } of order) {
		if (left <= 0) break;
		shares[index]++;
		left--;
	}
	return parts.map((part, index) => ({ label: part.name, percent: shares[index] }));
}

/** A share as the report shows it. */
export const percentText = (percent: number) => (percent === 0 ? 'under 1%' : `${percent}%`);

/** The report, as the page and the file both show it. */
export interface Report {
	name: string;
	madeOn: string;
	/** The document has changed since it was made. */
	stale: boolean;
	pitch: Block[];
	businessCase: Block[];
	business: { level: Level; label: string; reasons: Block[] };
	technical: { level: Level; label: string; reasons: Block[] };
	/** Each part's share of the building, in whole per cent adding up to 100. */
	work: Share[];
	byHand: Route;
	withAi: Route;
	running: Running;
	unpriced: string[];
	assumptions: Block[];
	settled: string[];
	basis: string[];
	/** Euros a person-day, so a row's cost can be shown beside its days. */
	dayRate: number;
}

export function buildReport(overview: Overview, about: { name: string; madeOn: string; stale: boolean }): Report {
	return {
		...about,
		pitch: toBlocks(overview.pitch),
		businessCase: toBlocks(overview.businessCase),
		business: {
			level: overview.businessComplexity.level,
			label: LEVEL_NAME[overview.businessComplexity.level],
			reasons: toBlocks(overview.businessComplexity.reasons, true)
		},
		technical: {
			level: overview.technicalComplexity.level,
			label: LEVEL_NAME[overview.technicalComplexity.level],
			reasons: toBlocks(overview.technicalComplexity.reasons, true)
		},
		work: shareOfWork(overview.work),
		byHand: byHand(overview),
		withAi: withAi(overview),
		running: running(overview),
		unpriced: overview.unpriced,
		assumptions: toBlocks(overview.assumptions, true),
		settled: overview.settled,
		basis: basis(overview.technicalComplexity.level),
		dayRate: DAY_RATE
	};
}

/* ------------------------------------------------------------ the file */

export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * What the file may load: nothing but its own styles. It carries no script, and
 * the model's words in it are escaped, so this is the second lock, not the first.
 */
export const REPORT_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

function blocksHtml(blocks: Block[]): string {
	return blocks
		.map((block) =>
			block.kind === 'paragraph'
				? `<p>${escapeHtml(block.text)}</p>`
				: `<ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
		)
		.join('\n');
}

const days = (n: number) => `${n} person-day${n === 1 ? '' : 's'}`;
const weeks = (n: number) => `${n} week${n === 1 ? '' : 's'}`;
const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

function routeHtml(title: string, summary: string, r: Route): string {
	const rows = r.rows
		.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td class="n">${row.days}</td><td class="n">${euros(row.days * DAY_RATE)}</td></tr>`)
		.join('');
	const usage = r.usage > 0 ? `<tr><td>AI assistant usage</td><td class="n"></td><td class="n">${euros(r.usage)}</td></tr>` : '';
	return `<div class="route">
<h3>${escapeHtml(title)}</h3>
<p class="muted">${escapeHtml(summary)}</p>
<p class="big">${euros(r.cost)}</p>
<p class="range">${euros(r.costLow)} – ${euros(r.costHigh)}</p>
<p>${days(r.days)} (${r.daysLow}–${r.daysHigh}) · about ${weeks(r.weeks)} with ${people(r.people)}</p>
<table><thead><tr><th>Work</th><th class="n">Person-days</th><th class="n">Cost</th></tr></thead>
<tbody>${rows}${usage}</tbody>
<tfoot><tr><td>Total</td><td class="n">${r.days}</td><td class="n">${euros(r.cost)}</td></tr></tfoot></table>
</div>`;
}

/**
 * The report as one HTML file, which opens in any browser with no network: its
 * styles inside it, no script, and a policy that lets it load nothing. Every word
 * that came from the model is escaped. Printed, it leaves out nothing.
 */
export function renderReport(report: Report): string {
	const name = escapeHtml(report.name);
	const r = report.running;
	const services = r.services
		.map(
			(s) =>
				`<tr><td><strong>${escapeHtml(s.name)}</strong><br><span class="muted">${escapeHtml(s.why || s.role)}</span></td><td>${escapeHtml(s.sku)}</td><td class="n">${euros(s.monthly)}</td></tr>`
		)
		.join('');
	const work = report.work
		.map(
			(part) =>
				`<tr><td>${escapeHtml(part.label)}</td><td class="share"><span class="bar" style="width:${part.percent}%"></span></td><td class="n">${percentText(part.percent)}</td></tr>`
		)
		.join('');

	return `<!DOCTYPE html>
<!--
  The business and technical overview of "${report.name.replace(/-{2,}/g, '-').replace(/[<>]/g, '')}", made by Specman's assistant
  from its design document on ${report.madeOn}. Estimates for planning, not a quote.
-->
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${REPORT_POLICY}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} — business and technical overview</title>
<style>
:root{--ink:#16201c;--soft:#5c6b64;--line:#dfe4e1;--accent:#0e5340;--accent-soft:#e6efeb;--warn:#fdf4e4}
*{box-sizing:border-box}
body{margin:0;background:#f6f7f6;color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:960px;margin:0 auto;padding:40px 28px 60px;background:#fff}
header{border-bottom:3px solid var(--accent);padding-bottom:18px;margin-bottom:28px}
.kicker{color:var(--accent);font-weight:600;text-transform:uppercase;letter-spacing:.06em;font-size:12px;margin:0}
h1{font-size:30px;margin:4px 0 6px}
h2{font-size:19px;margin:36px 0 12px;color:var(--accent)}
h3{font-size:16px;margin:0 0 4px}
p{margin:0 0 10px}
ul{margin:0 0 10px;padding-left:22px}
.muted{color:var(--soft);font-size:13px}
.stale{background:var(--warn);border:1px solid #eddcb8;color:#6f4a0d;border-radius:8px;padding:10px 14px;margin:0 0 20px}
.pitch{font-size:19px;line-height:1.5;border-left:4px solid var(--accent);padding:4px 0 4px 18px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.card,.route{border:1px solid var(--line);border-radius:10px;padding:16px 18px;break-inside:avoid}
.level{display:inline-block;border-radius:999px;padding:2px 12px;font-weight:600;font-size:13px;margin:2px 0 10px}
.level.low{background:#e3f1e8;color:#1d5b36}.level.medium{background:#fbf0d9;color:#7a5410}.level.high{background:#f9e1df;color:#8a2a20}
.big{font-size:28px;font-weight:700;margin:8px 0 0;color:var(--accent)}
.range{color:var(--soft);margin:0 0 6px}
table{width:100%;border-collapse:collapse;margin:10px 0 0;font-size:14px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;color:var(--soft);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.n{text-align:right;white-space:nowrap}
.share{width:30%;vertical-align:middle}.bar{display:block;height:8px;min-width:2px;border-radius:4px;background:var(--accent);print-color-adjust:exact;-webkit-print-color-adjust:exact}
tfoot td{font-weight:700;border-bottom:0;border-top:2px solid var(--ink)}
.totals{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:16px}
.totals div{background:var(--accent-soft);border-radius:10px;padding:12px 14px}
.totals strong{display:block;font-size:20px}
footer{margin-top:40px;border-top:1px solid var(--line);padding-top:14px}
@media (max-width:720px){.pair,.totals{grid-template-columns:1fr}main{padding:24px 16px}}
@media print{body{background:#fff}main{padding:0;max-width:none}h2{break-after:avoid}@page{margin:16mm}}
</style>
</head>
<body>
<main>
<header>
<p class="kicker">Business and technical overview</p>
<h1>${name}</h1>
<p class="muted">Made by Specman's assistant from the design document on ${escapeHtml(report.madeOn)}. The figures are estimates for planning, not a quote.</p>
</header>
${report.stale ? '<p class="stale">The design document has changed since this overview was made, so parts of it may be out of date.</p>' : ''}
<section>
<h2>In short</h2>
<div class="pitch">${blocksHtml(report.pitch)}</div>
</section>
<section>
<h2>Business case</h2>
${blocksHtml(report.businessCase)}
</section>
<section>
<h2>How complex it is</h2>
<div class="pair">
<div class="card"><h3>For the business</h3><span class="level ${report.business.level}">${report.business.label}</span>${blocksHtml(report.business.reasons)}</div>
<div class="card"><h3>Technically</h3><span class="level ${report.technical.level}">${report.technical.label}</span>${blocksHtml(report.technical.reasons)}</div>
</div>
</section>
<section>
<h2>Building it</h2>
<div class="pair">
${routeHtml('By people', 'A professional team writes the code by hand.', report.byHand)}
${routeHtml('With an AI coding assistant', 'The AI writes the code; people direct it, review it and accept it.', report.withAi)}
</div>
<h3 style="margin-top:22px">What the building consists of</h3>
<table><thead><tr><th>Part</th><th colspan="2" class="n">Share of the work</th></tr></thead><tbody>${work}</tbody></table>
</section>
<section>
<h2>Running it on Azure</h2>
<p class="muted">The company's reference architecture for an internal web application, sized for this one.</p>
<table><thead><tr><th>Service</th><th>Size</th><th class="n">Per month</th></tr></thead>
<tbody>${services}</tbody>
<tfoot><tr><td colspan="2">Production</td><td class="n">${euros(r.production)}</td></tr></tfoot></table>
${report.unpriced.length > 0 ? `<p class="muted">Also named by the assistant, but not in the price list and not counted: ${escapeHtml(report.unpriced.join(', '))}.</p>` : ''}
<div class="totals">
<div>Azure, every environment<strong>${euros(r.monthly)} a month</strong><span class="muted">${euros(r.yearly)} a year, of which development and test ${euros(r.nonProduction)} a month</span></div>
<div>Support and small changes<strong>${euros(r.support)} a year</strong><span class="muted">people's time</span></div>
<div>Running it, in all<strong>${euros(r.yearly + r.support)} a year</strong><span class="muted">Azure and support</span></div>
</div>
</section>
<section>
<h2>What this rests on</h2>
${report.assumptions.length > 0 ? `<h3>The assistant assumed</h3>${blocksHtml(report.assumptions)}` : ''}
<h3>How the figures are calculated</h3>
<ul>${[...report.settled, ...report.basis].map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
</section>
<footer class="muted">The design document, not this overview, is what to build from.</footer>
</main>
</body>
</html>
`;
}

/** Headers for the downloaded file. */
export function reportHeaders(): Record<string, string> {
	return {
		'content-type': 'text/html; charset=utf-8',
		'content-security-policy': `${REPORT_POLICY}; frame-ancestors 'none'`,
		'x-content-type-options': 'nosniff',
		'referrer-policy': 'no-referrer',
		'cache-control': 'no-store'
	};
}

/** The downloaded file's name. */
export function reportFileName(slug: string): string {
	return `${slug.replace(/[^a-z0-9-]/gi, '') || 'application'}-overview.html`;
}
