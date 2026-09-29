/**
 * An ArchiMate-shaped model of the application, derived from the document.
 *
 * The design document is prose and rules; neither shows how the parts relate.
 * "What the application does" is the chapter that matters most and the one where
 * a reader most needs to see the shape — which capability serves which role,
 * what each touches, and where the outside world connects.
 *
 * Three layers, following ArchiMate:
 *
 *   Business     who is involved and what they do
 *   Application  what the application offers, and the information it holds
 *   Technology   the systems and infrastructure underneath
 *
 * Elements are identified by a slug of their name rather than by an id the model
 * invents. Models are consistent about naming the same thing the same way and
 * careless about identifiers, so a relation that names "Employee" resolves
 * reliably while one referring to "e3" often does not.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

export type Layer = 'business' | 'application' | 'technology';

export type ElementType =
	| 'actor'
	| 'process'
	| 'service'
	| 'data'
	| 'system'
	| 'infrastructure';

export type RelationKind = 'assigned' | 'serves' | 'accesses' | 'flow';

export interface Element {
	id: string;
	name: string;
	type: ElementType;
	layer: Layer;
	/** Chapter this came from, so the diagram can link back into the document. */
	chapter: string;
}

export interface Relation {
	from: string;
	to: string;
	kind: RelationKind;
}

export interface ArchitectureModel {
	elements: Element[];
	relations: Relation[];
}

const LAYER_OF: Record<ElementType, Layer> = {
	actor: 'business',
	process: 'business',
	service: 'application',
	data: 'application',
	system: 'technology',
	infrastructure: 'technology'
};

const TYPES = Object.keys(LAYER_OF) as ElementType[];
const KINDS: RelationKind[] = ['assigned', 'serves', 'accesses', 'flow'];

export function slug(name: string): string {
	return name
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

export function layerOf(type: ElementType): Layer {
	return LAYER_OF[type] ?? 'application';
}

/** Read an `<element>` block. */
export function toElement(attrs: Record<string, string>, body: string): Element | null {
	const name = (attrs.name || body).replace(/\s+/g, ' ').trim();
	if (name.length < 2 || name.length > 60) return null;

	const raw = (attrs.type ?? '').trim().toLowerCase() as ElementType;
	// An unrecognised type becomes an application service: it is the neutral
	// middle of the diagram, and a mislabelled box is better than a dropped one.
	const type = TYPES.includes(raw) ? raw : 'service';

	return {
		id: slug(name),
		name,
		type,
		layer: layerOf(type),
		chapter: (attrs.chapter ?? '').trim().toLowerCase()
	};
}

/** Read a `<relation>` block. Endpoints are names; they resolve to slugs. */
export function toRelation(attrs: Record<string, string>): Relation | null {
	const from = slug((attrs.from ?? '').trim());
	const to = slug((attrs.to ?? '').trim());
	if (!from || !to || from === to) return null;

	const raw = (attrs.kind ?? '').trim().toLowerCase() as RelationKind;
	return { from, to, kind: KINDS.includes(raw) ? raw : 'serves' };
}

/**
 * Assemble a model, discarding what cannot be drawn.
 *
 * A relation naming something that was never declared is dropped rather than
 * inventing a box for it: a diagram with a mystery element in it is worse than
 * one missing a line, because the reader cannot tell which parts to trust.
 */
export function buildModel(elements: Element[], relations: Relation[]): ArchitectureModel {
	const byId = new Map<string, Element>();
	for (const element of elements) {
		if (!byId.has(element.id)) byId.set(element.id, element);
	}

	const seen = new Set<string>();
	const resolved: Relation[] = [];

	for (const relation of relations) {
		if (!byId.has(relation.from) || !byId.has(relation.to)) continue;

		const key = `${relation.from}>${relation.to}>${relation.kind}`;
		if (seen.has(key)) continue;
		seen.add(key);
		resolved.push(relation);
	}

	return { elements: [...byId.values()], relations: resolved };
}

export function elementsInLayer(model: ArchitectureModel, layer: Layer): Element[] {
	return model.elements.filter((element) => element.layer === layer);
}
