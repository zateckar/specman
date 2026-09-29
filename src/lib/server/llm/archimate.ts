/**
 * Exporting the model as an ArchiMate Open Exchange File.
 *
 * The picture Specman draws is deliberately simple, and at some point an
 * architect will want it in a real modelling tool — to extend it, to compare it
 * against the landscape, or simply because that is where models live. The Open
 * Group's exchange format is the one format every ArchiMate tool reads, so
 * exporting it means the work leaves here without being retyped.
 *
 * Namespace is 3.0 (unchanged since), validated against the 3.1 schema, which is
 * what Archi itself emits.
 *
 * Two things are worth knowing about what is *not* exported:
 *
 *  - The three bands are not exported as container nodes. Nested nodes in this
 *    format carry coordinates relative to their parent, which is a well-known
 *    source of import bugs, and a band is decoration rather than containment.
 *    The layers travel in `<organizations>` instead, which is what populates the
 *    model tree in Archi, and in the element types themselves.
 *  - Nothing is invented to make the file tidier. What the document says is what
 *    the file contains.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

interface ExportElement {
	id: string;
	name: string;
	type: string;
	layer: string;
	chapter: string;
}

interface ExportRelation {
	from: string;
	to: string;
	kind: string;
}

interface ExportBox {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

interface ExportEdge {
	from: string;
	to: string;
	kind: string;
	points: Array<{ x: number; y: number }>;
}

export interface ExchangeMeta {
	/** The application's name; becomes the model name. */
	name: string;
	documentation?: string;
	viewName?: string;
	/** Chapter key to title, so provenance reads as prose rather than as a slug. */
	chapterTitles?: Record<string, string>;
}

/**
 * ArchiMate concept for one of our element types.
 *
 * Keyed on layer and type together. Our layers are derived from the type, so the
 * pair is normally redundant — but a stored model from an earlier version may
 * disagree, and honouring the layer keeps a technology element out of the
 * application layer.
 */
const CONCEPT: Record<string, string> = {
	'business:actor': 'BusinessActor',
	'business:process': 'BusinessProcess',
	'business:service': 'BusinessService',
	'business:data': 'BusinessObject',
	'business:system': 'BusinessActor',
	'business:infrastructure': 'BusinessActor',
	'application:actor': 'ApplicationComponent',
	'application:process': 'ApplicationProcess',
	'application:service': 'ApplicationService',
	'application:data': 'DataObject',
	'application:system': 'ApplicationComponent',
	'application:infrastructure': 'Node',
	'technology:actor': 'Node',
	'technology:process': 'TechnologyProcess',
	'technology:service': 'TechnologyService',
	'technology:data': 'Artifact',
	'technology:system': 'SystemSoftware',
	'technology:infrastructure': 'Node'
};

const RELATIONSHIP: Record<string, string> = {
	assigned: 'Assignment',
	serves: 'Serving',
	accesses: 'Access',
	flow: 'Flow'
};

/** The layer colours from the ArchiMate specification, as the format wants them. */
const FILL: Record<string, [number, number, number]> = {
	business: [255, 255, 181],
	application: [181, 255, 255],
	technology: [201, 231, 183]
};

const LAYERS: Array<{ layer: string; label: string }> = [
	{ layer: 'business', label: 'Business' },
	{ layer: 'application', label: 'Application' },
	{ layer: 'technology', label: 'Technology' }
];

export function conceptFor(type: string, layer: string): string {
	return CONCEPT[`${layer}:${type}`] ?? CONCEPT[`application:${type}`] ?? 'ApplicationService';
}

export function relationshipFor(kind: string): string {
	return RELATIONSHIP[kind] ?? 'Association';
}

export function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/**
 * Identifiers have to be XML names and unique across the whole file, and the
 * format shares one identifier space between elements, relationships, view nodes
 * and connections. Each kind gets its own prefix so nothing can collide, and the
 * prefix also rescues a name that begins with a digit.
 */
function elementId(id: string): string {
	return `id-e-${id}`;
}

function nodeId(id: string): string {
	return `id-n-${id}`;
}

export function toOpenExchange(
	model: { elements: ExportElement[]; relations: ExportRelation[] },
	diagram: { boxes: ExportBox[]; edges: ExportEdge[] },
	meta: ExchangeMeta
): string {
	const lines: string[] = [];
	const viewName = meta.viewName ?? 'How it fits together';
	const titles = meta.chapterTitles ?? {};

	lines.push('<?xml version="1.0" encoding="UTF-8"?>');
	lines.push('<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/"');
	lines.push('       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
	lines.push(
		'       xsi:schemaLocation="http://www.opengroup.org/xsd/archimate/3.0/ http://www.opengroup.org/xsd/archimate/3.1/archimate3_Diagram.xsd"'
	);
	lines.push('       identifier="id-model">');
	lines.push(`  <name xml:lang="en">${escapeXml(meta.name)}</name>`);
	if (meta.documentation) {
		lines.push(`  <documentation xml:lang="en">${escapeXml(meta.documentation)}</documentation>`);
	}

	/* ------------------------------------------------------------- elements */

	if (model.elements.length > 0) {
		lines.push('  <elements>');
		for (const element of model.elements) {
			const concept = conceptFor(element.type, element.layer);
			lines.push(`    <element identifier="${elementId(element.id)}" xsi:type="${concept}">`);
			lines.push(`      <name xml:lang="en">${escapeXml(element.name)}</name>`);

			const chapter = element.chapter ? (titles[element.chapter] ?? element.chapter) : '';
			if (chapter) {
				lines.push(
					`      <documentation xml:lang="en">${escapeXml(`Described in “${chapter}”.`)}</documentation>`
				);
			}
			lines.push('    </element>');
		}
		lines.push('  </elements>');
	}

	/* -------------------------------------------------------- relationships */

	// Only relations between elements that made it into the file, mirroring the
	// rule the diagram already follows: a relation with a missing end is dropped
	// rather than given something to point at.
	const known = new Set(model.elements.map((element) => element.id));
	const relations = model.relations.filter(
		(relation) => known.has(relation.from) && known.has(relation.to)
	);
	const relationId = new Map<string, string>();
	relations.forEach((relation, index) => {
		relationId.set(`${relation.from}>${relation.to}>${relation.kind}`, `id-r${index + 1}`);
	});

	if (relations.length > 0) {
		lines.push('  <relationships>');
		for (const relation of relations) {
			const id = relationId.get(`${relation.from}>${relation.to}>${relation.kind}`);
			const type = relationshipFor(relation.kind);
			// "Reads or writes" is what the legend promises the reader, so the
			// access type says exactly that rather than defaulting to write.
			const access = type === 'Access' ? ' accessType="ReadWrite"' : '';
			lines.push(
				`    <relationship identifier="${id}" source="${elementId(relation.from)}" target="${elementId(relation.to)}"${access} xsi:type="${type}"/>`
			);
		}
		lines.push('  </relationships>');
	}

	/* -------------------------------------------------------- organizations */

	const populated = LAYERS.filter((layer) =>
		model.elements.some((element) => element.layer === layer.layer)
	);

	if (populated.length > 0) {
		lines.push('  <organizations>');
		for (const layer of populated) {
			lines.push('    <item>');
			lines.push(`      <label xml:lang="en">${layer.label}</label>`);
			for (const element of model.elements.filter((e) => e.layer === layer.layer)) {
				lines.push(`      <item identifierRef="${elementId(element.id)}"/>`);
			}
			lines.push('    </item>');
		}
		lines.push('  </organizations>');
	}

	/* ----------------------------------------------------------------- view */

	const layerOfElement = new Map(model.elements.map((element) => [element.id, element.layer]));
	const drawn = diagram.boxes.filter((box) => known.has(box.id));

	if (drawn.length > 0) {
		lines.push('  <views>');
		lines.push('    <diagrams>');
		lines.push('      <view identifier="id-v-main" xsi:type="Diagram">');
		lines.push(`        <name xml:lang="en">${escapeXml(viewName)}</name>`);

		for (const box of drawn) {
			const fill = FILL[layerOfElement.get(box.id) ?? 'application'] ?? FILL.application;
			lines.push(
				`        <node identifier="${nodeId(box.id)}" elementRef="${elementId(box.id)}" xsi:type="Element" x="${Math.round(box.x)}" y="${Math.round(box.y)}" w="${Math.round(box.width)}" h="${Math.round(box.height)}">`
			);
			lines.push('          <style>');
			lines.push(`            <fillColor r="${fill[0]}" g="${fill[1]}" b="${fill[2]}"/>`);
			lines.push('            <font name="Sans" size="9"><color r="36" g="49" b="43"/></font>');
			lines.push('          </style>');
			lines.push('        </node>');
		}

		const laidOut = new Set(drawn.map((box) => box.id));
		let connection = 0;
		for (const edge of diagram.edges) {
			const id = relationId.get(`${edge.from}>${edge.to}>${edge.kind}`);
			if (!id || !laidOut.has(edge.from) || !laidOut.has(edge.to)) continue;

			connection++;
			lines.push(
				`        <connection identifier="id-c${connection}" relationshipRef="${id}" source="${nodeId(edge.from)}" target="${nodeId(edge.to)}" xsi:type="Relationship">`
			);
			// Only the corners travel: the format expects a tool to work out where
			// a line meets a box, and the endpoints are exactly that.
			for (const point of edge.points.slice(1, -1)) {
				lines.push(`          <bendpoint x="${Math.round(point.x)}" y="${Math.round(point.y)}"/>`);
			}
			lines.push('        </connection>');
		}

		lines.push('      </view>');
		lines.push('    </diagrams>');
		lines.push('  </views>');
	}

	lines.push('</model>');
	return `${lines.join('\n')}\n`;
}
