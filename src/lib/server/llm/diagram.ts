/**
 * Laying out the layered diagram.
 *
 * Deterministic geometry, so the same model always draws the same picture — a
 * diagram that shuffles itself between views is unreadable, and a random layout
 * cannot be tested. Positions are computed here and rendered as plain SVG, so
 * there is no diagramming dependency and nothing to load at runtime.
 *
 * Following ArchiMate: three horizontal bands, business at the top, technology
 * at the bottom. Elements keep the order they were declared in, which is the
 * order the document discusses them.
 *
 * Connectors are routed orthogonally through reserved space rather than drawn
 * straight between two centres. Straight lines take the shortest path, and the
 * shortest path runs underneath whatever boxes lie in between — so a relation
 * could not be followed with the eye, which is the whole reason to draw the
 * picture. Two kinds of corridor are kept free of boxes:
 *
 *   channels  the horizontal gaps above and below each row
 *   gutters   the vertical gaps beside each column, running the full height
 *
 * Every segment of every connector lies in a corridor, so no line can pass under
 * a box — an invariant the tests check segment by segment. Corridors widen to fit
 * however many wires they carry, so the picture grows to fit its own wiring
 * rather than overlapping it.
 *
 * Rows are left-aligned on one column grid for the same reason: centring a short
 * row would break the gutters into disconnected pieces, and a vertical run could
 * no longer be guaranteed box-free.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

export interface LaidOutBox {
	id: string;
	name: string;
	/** The name split to fit the box. Computed here so the height can allow for it. */
	lines: string[];
	type: string;
	layer: string;
	chapter: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface Point {
	x: number;
	y: number;
}

export interface LaidOutEdge {
	from: string;
	to: string;
	kind: string;
	/** The orthogonal route: first point on the source border, last on the target's. */
	points: Point[];
	/** The same route as an SVG path, so the renderer needs no geometry of its own. */
	path: string;
	/** The two ends on their own, for arrowheads and hit-testing. */
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export interface LaidOutBand {
	layer: string;
	label: string;
	x: number;
	y: number;
	width: number;
	height: number;
	/** Where the label is written, upright along the left edge. No wire enters it. */
	labelArea: { x: number; y: number; width: number; height: number };
}

export interface Diagram {
	width: number;
	height: number;
	bands: LaidOutBand[];
	boxes: LaidOutBox[];
	edges: LaidOutEdge[];
}

interface InputElement {
	id: string;
	name: string;
	type: string;
	layer: string;
	chapter: string;
}

interface InputRelation {
	from: string;
	to: string;
	kind: string;
}

const BOX_WIDTH = 180;
/** Room for the notation icon plus up to three lines of centred name. */
const BOX_HEIGHT = 84;
const MAX_NAME_LINES = 3;
const CHARS_PER_LINE = 22;

/** Clearance between two parallel wires sharing a corridor. */
const LANE = 12;

const COLUMN_GAP = 46;
/** The corridors outside the outermost columns are mostly padding. */
const OUTER_GAP = 26;
const ROW_GAP = 52;
const BAND_GAP = 46;
/** Room above a band's first row for its label. */
const BAND_PAD_TOP = 34;
const BAND_PAD = 24;
const MARGIN = 18;
/**
 * A strip down the left of every band for its name, outside every corridor.
 * Written across the top of the band, the name sat where the first gutter and
 * the channel above the band's first row both run, so wires went through it.
 */
const LABEL_STRIP = 24;

const BANDS: Array<{ layer: string; label: string }> = [
	{ layer: 'business', label: 'Business' },
	{ layer: 'application', label: 'Application' },
	{ layer: 'technology', label: 'Technology' }
];

/**
 * Split a name to fit the box.
 *
 * Done here rather than in the renderer so the box height can account for it —
 * a three-line name in a box sized for one spills out of the bottom.
 */
export function wrapName(name: string): string[] {
	if (name.length <= CHARS_PER_LINE) return [name];

	// A word longer than a line is broken across lines, with a hyphen. Kept
	// whole, "Fahrzeugdisponierungssystem" ran out of both sides of its box.
	const words = name
		.split(/\s+/)
		.filter(Boolean)
		.flatMap((word) => {
			if (word.length <= CHARS_PER_LINE) return [word];
			const pieces: string[] = [];
			for (let at = 0; at < word.length; at += CHARS_PER_LINE - 1) {
				const rest = word.length - at;
				pieces.push(rest > CHARS_PER_LINE ? `${word.slice(at, at + CHARS_PER_LINE - 1)}-` : word.slice(at));
				if (rest <= CHARS_PER_LINE) break;
			}
			return pieces;
		});

	const lines: string[] = [''];
	for (const word of words) {
		const current = lines[lines.length - 1];
		if (current && `${current} ${word}`.length > CHARS_PER_LINE) lines.push(word);
		else lines[lines.length - 1] = current ? `${current} ${word}` : word;
	}

	if (lines.length <= MAX_NAME_LINES) return lines;

	// Rather than drop the tail silently, mark that it was shortened — inside
	// the line's width, or the mark itself is what spills out of the box.
	const kept = lines.slice(0, MAX_NAME_LINES);
	const last = kept[MAX_NAME_LINES - 1].replace(/-$/, '');
	kept[MAX_NAME_LINES - 1] = `${last.slice(0, CHARS_PER_LINE - 1).trimEnd()}…`;
	return kept;
}

type Side = 'top' | 'bottom' | 'left' | 'right';

interface Cell {
	row: number;
	column: number;
}

/**
 * How one connector gets from its source to its target.
 *
 *   sideways  neighbours in the same row: out of the facing sides, jogging in
 *             the gutter between them
 *   hop       one horizontal run in a single channel, with a stub at each end
 *   detour    two channels joined by a vertical run in a gutter, for endpoints
 *             more than one row apart
 */
interface RoutePlan {
	relation: InputRelation;
	from: Cell;
	to: Cell;
	fromSide: Side;
	toSide: Side;
	shape: 'sideways' | 'hop' | 'detour';
	/** Channel carrying the run beside the source. */
	near: number;
	/** Channel carrying the run beside the target, for a detour. */
	far: number;
	/** Vertical corridor used to change row, or to jog between two neighbours. */
	gutter: number | null;
}

function planRoute(relation: InputRelation, from: Cell, to: Cell): RoutePlan {
	const base = { relation, from, to };

	if (from.row === to.row) {
		// Neighbours read best as a plain line between their facing sides. Boxes
		// further apart in the row cannot be joined that way without crossing
		// whatever sits between them, so those drop into the channel below.
		if (Math.abs(from.column - to.column) === 1) {
			const rightwards = from.column < to.column;
			return {
				...base,
				fromSide: rightwards ? 'right' : 'left',
				toSide: rightwards ? 'left' : 'right',
				shape: 'sideways',
				near: -1,
				far: -1,
				gutter: Math.max(from.column, to.column)
			};
		}

		const channel = from.row + 1;
		return {
			...base,
			fromSide: 'bottom',
			toSide: 'bottom',
			shape: 'hop',
			near: channel,
			far: channel,
			gutter: null
		};
	}

	const downwards = from.row < to.row;
	const near = downwards ? from.row + 1 : from.row;
	const far = downwards ? to.row : to.row + 1;
	const fromSide: Side = downwards ? 'bottom' : 'top';
	const toSide: Side = downwards ? 'top' : 'bottom';

	if (near === far) {
		return { ...base, fromSide, toSide, shape: 'hop', near, far, gutter: null };
	}

	// Which gutter is chosen depends on what the other routes are doing, so it is
	// settled once they are all known.
	return { ...base, fromSide, toSide, shape: 'detour', near, far, gutter: null };
}

/**
 * Which vertical corridor a long route should take.
 *
 * The nearest quiet one, where quiet counts for rather more than near: routes
 * that all pile into the same gutter become a bundle nobody can follow, while a
 * corridor a column further out costs the reader almost nothing. Ties go to the
 * lower index, so the picture stays reproducible.
 */
function chooseGutter(from: Cell, to: Cell, perRow: number, load: number[]): number {
	const candidates: number[] = [];

	if (from.column === to.column) {
		// Either side of the column the two share.
		candidates.push(from.column, from.column + 1);
	} else {
		// Every corridor that runs between the two columns.
		for (let g = Math.min(from.column, to.column) + 1; g <= Math.max(from.column, to.column); g++) {
			candidates.push(g);
		}
	}

	const middle = (from.column + to.column + 1) / 2;
	let best = candidates[0] ?? Math.min(from.column, perRow);
	let bestScore = Infinity;

	for (const candidate of candidates) {
		const score = load[candidate] + Math.abs(candidate - middle) / 2;
		if (score < bestScore) {
			bestScore = score;
			best = candidate;
		}
	}

	return best;
}

/** Drop points that add nothing: repeats, and corners that are not corners. */
function simplify(points: Point[]): Point[] {
	const kept: Point[] = [];

	for (const point of points) {
		const last = kept[kept.length - 1];
		if (last && last.x === point.x && last.y === point.y) continue;
		kept.push(point);
	}

	for (let i = 1; i < kept.length - 1; ) {
		const before = kept[i - 1];
		const after = kept[i + 1];
		const collinear =
			(before.x === kept[i].x && kept[i].x === after.x) ||
			(before.y === kept[i].y && kept[i].y === after.y);
		if (collinear) kept.splice(i, 1);
		else i++;
	}

	return kept;
}

/**
 * An SVG path for a route, with its corners rounded.
 *
 * Rounded corners are not decoration: at a sharp right angle two wires crossing
 * nearby look like one wire turning, and the rounding makes which is which
 * obvious. The radius shrinks on a short segment so a tight jog stays orthogonal
 * instead of collapsing into a curve.
 */
export function edgePath(points: Point[], radius = 9): string {
	if (points.length < 2) return '';

	const round = (value: number) => Math.round(value * 10) / 10;
	let path = `M ${round(points[0].x)} ${round(points[0].y)}`;

	for (let i = 1; i < points.length - 1; i++) {
		const previous = points[i - 1];
		const corner = points[i];
		const next = points[i + 1];

		const inLength = Math.abs(corner.x - previous.x) + Math.abs(corner.y - previous.y);
		const outLength = Math.abs(next.x - corner.x) + Math.abs(next.y - corner.y);
		const r = Math.min(radius, inLength / 2, outLength / 2);

		const towards = (target: Point) => {
			const length = Math.abs(target.x - corner.x) + Math.abs(target.y - corner.y) || 1;
			return {
				x: corner.x + ((target.x - corner.x) * r) / length,
				y: corner.y + ((target.y - corner.y) * r) / length
			};
		};

		const start = towards(previous);
		const end = towards(next);
		path += ` L ${round(start.x)} ${round(start.y)}`;
		path += ` Q ${round(corner.x)} ${round(corner.y)} ${round(end.x)} ${round(end.y)}`;
	}

	const last = points[points.length - 1];
	return `${path} L ${round(last.x)} ${round(last.y)}`;
}

export function layoutDiagram(
	model: {
		elements: InputElement[];
		relations: InputRelation[];
	},
	options: { maxPerRow?: number } = {}
): Diagram {
	const widest = Math.max(
		1,
		...BANDS.map((band) => model.elements.filter((e) => e.layer === band.layer).length)
	);
	const perRow = Math.max(1, Math.min(options.maxPerRow ?? 4, widest));

	/* ---------------------------------------------------------------- rows */

	// Every band keeps at least one row, so all three layers are always drawn
	// even when a layer has nothing in it yet.
	const rows: InputElement[][] = [];
	const bandRows: Array<{ layer: string; label: string; first: number; last: number }> = [];
	const rowLayer: string[] = [];

	for (const band of BANDS) {
		const inLayer = model.elements.filter((element) => element.layer === band.layer);
		const first = rows.length;

		for (let row = 0; row < Math.max(1, Math.ceil(inLayer.length / perRow)); row++) {
			rows.push(inLayer.slice(row * perRow, (row + 1) * perRow));
			rowLayer.push(band.layer);
		}

		bandRows.push({ layer: band.layer, label: band.label, first, last: rows.length - 1 });
	}

	const rowCount = rows.length;
	const cells = new Map<string, Cell>();
	rows.forEach((row, r) =>
		row.forEach((element, c) => {
			if (!cells.has(element.id)) cells.set(element.id, { row: r, column: c });
		})
	);

	/* -------------------------------------------------------------- routes */

	// Planned before anything is positioned, because how many wires a corridor
	// carries decides how wide it has to be.
	const plans: RoutePlan[] = [];
	for (const relation of model.relations) {
		const from = cells.get(relation.from);
		const to = cells.get(relation.to);
		if (!from || !to) continue;
		plans.push(planRoute(relation, from, to));
	}

	const channelLoad = new Array<number>(rowCount + 1).fill(0);
	const gutterLoad = new Array<number>(perRow + 1).fill(0);

	// Wires between neighbours have no choice of corridor, so they are counted
	// first and the longer routes spread themselves around whatever is left.
	for (const plan of plans) {
		if (plan.shape === 'sideways') gutterLoad[plan.gutter as number]++;
	}

	for (const plan of plans) {
		if (plan.shape === 'hop') {
			channelLoad[plan.near]++;
			continue;
		}
		if (plan.shape !== 'detour') continue;

		plan.gutter = chooseGutter(plan.from, plan.to, perRow, gutterLoad);
		gutterLoad[plan.gutter]++;
		channelLoad[plan.near]++;
		channelLoad[plan.far]++;
	}

	/* ------------------------------------------------------------ geometry */

	const channelMin = (index: number): number => {
		if (index === 0) return BAND_PAD_TOP;
		if (index === rowCount) return BAND_PAD;
		// A channel on a band boundary spans both bands' padding and the gap
		// between them, so it is roomy without being widened.
		if (rowLayer[index - 1] !== rowLayer[index]) return BAND_PAD + BAND_GAP + BAND_PAD_TOP;
		return ROW_GAP;
	};

	const channelHeight = channelLoad.map((load, index) =>
		Math.max(channelMin(index), (load + 1) * LANE)
	);
	const gutterWidth = gutterLoad.map((load, index) =>
		Math.max(index === 0 || index === perRow ? OUTER_GAP : COLUMN_GAP, (load + 1) * LANE)
	);

	const channelY: number[] = [];
	const rowY: number[] = [];
	let y = MARGIN;
	for (let row = 0; row < rowCount; row++) {
		channelY.push(y);
		y += channelHeight[row];
		rowY.push(y);
		y += BOX_HEIGHT;
	}
	channelY.push(y);
	y += channelHeight[rowCount];
	const height = y + MARGIN;

	const gutterX: number[] = [];
	const columnX: number[] = [];
	let x = MARGIN + LABEL_STRIP;
	for (let column = 0; column < perRow; column++) {
		gutterX.push(x);
		x += gutterWidth[column];
		columnX.push(x);
		x += BOX_WIDTH;
	}
	gutterX.push(x);
	x += gutterWidth[perRow];
	const width = x + MARGIN;

	const boxes: LaidOutBox[] = [];
	rows.forEach((row, r) =>
		row.forEach((element, c) => {
			boxes.push({
				id: element.id,
				name: element.name,
				lines: wrapName(element.name),
				type: element.type,
				layer: element.layer,
				chapter: element.chapter,
				x: columnX[c],
				y: rowY[r],
				width: BOX_WIDTH,
				height: BOX_HEIGHT
			});
		})
	);

	const bands: LaidOutBand[] = bandRows.map((band, index) => {
		const top = index === 0 ? channelY[0] : rowY[band.first] - BAND_PAD_TOP;
		const bottom =
			index === bandRows.length - 1
				? channelY[rowCount] + channelHeight[rowCount]
				: rowY[band.last] + BOX_HEIGHT + BAND_PAD;

		return {
			layer: band.layer,
			label: band.label,
			x: MARGIN,
			y: top,
			width: width - MARGIN * 2,
			height: bottom - top,
			labelArea: { x: MARGIN, y: top, width: LABEL_STRIP, height: bottom - top }
		};
	});

	/* --------------------------------------------------------------- wires */

	const byId = new Map(boxes.map((box) => [box.id, box]));
	const centreOf = (cell: Cell) => ({
		x: columnX[cell.column] + BOX_WIDTH / 2,
		y: rowY[cell.row] + BOX_HEIGHT / 2
	});
	const gutterCentre = (index: number) => gutterX[index] + gutterWidth[index] / 2;

	// Spread the wires leaving one side of a box across that side, ordered by
	// where each is headed, so two lines out of the same box neither overlap nor
	// cross each other on the way out.
	interface Attachment {
		plan: number;
		end: 'from' | 'to';
		aim: number;
	}
	const attachments = new Map<string, Attachment[]>();
	const attach = (id: string, side: Side, attachment: Attachment) => {
		const key = `${id} ${side}`;
		const list = attachments.get(key);
		if (list) list.push(attachment);
		else attachments.set(key, [attachment]);
	};

	plans.forEach((plan, index) => {
		const aim =
			plan.gutter === null
				? null
				: plan.shape === 'sideways'
					? null
					: gutterCentre(plan.gutter);

		attach(plan.relation.from, plan.fromSide, {
			plan: index,
			end: 'from',
			aim: aim ?? centreOf(plan.to).x
		});
		attach(plan.relation.to, plan.toSide, {
			plan: index,
			end: 'to',
			aim: aim ?? centreOf(plan.from).x
		});
	});

	const ports: Array<{ from: Point; to: Point }> = plans.map(() => ({
		from: { x: 0, y: 0 },
		to: { x: 0, y: 0 }
	}));

	for (const [key, list] of attachments) {
		const separator = key.indexOf(' ');
		const box = byId.get(key.slice(0, separator));
		const side = key.slice(separator + 1) as Side;
		if (!box) continue;

		// Sideways wires all aim at the same place, so their order is the order
		// they were declared — stable, which is all determinism needs.
		if (side === 'top' || side === 'bottom') list.sort((a, b) => a.aim - b.aim);

		list.forEach((attachment, index) => {
			const along = (extent: number) => Math.round((extent * (index + 1)) / (list.length + 1));
			const point =
				side === 'top'
					? { x: box.x + along(box.width), y: box.y }
					: side === 'bottom'
						? { x: box.x + along(box.width), y: box.y + box.height }
						: side === 'left'
							? { x: box.x, y: box.y + along(box.height) }
							: { x: box.x + box.width, y: box.y + along(box.height) };

			ports[attachment.plan][attachment.end] = point;
		});
	}

	// Lanes within a corridor, ordered by where each run starts, so parallel wires
	// stay parallel instead of stacking on one line. Horizontal runs are placed
	// first, because a vertical run's extent is only known once the two channels it
	// joins have been settled.
	interface Lane {
		plan: number;
		end: 'near' | 'far';
		order: number;
	}
	const laneY: Array<{ near: number; far: number }> = plans.map(() => ({ near: 0, far: 0 }));
	const laneX: number[] = plans.map(() => 0);

	const channelLanes: Lane[][] = channelHeight.map(() => []);
	plans.forEach((plan, index) => {
		if (plan.shape === 'sideways') return;

		const from = ports[index].from;
		const to = ports[index].to;
		const gutter = plan.gutter === null ? null : gutterCentre(plan.gutter);

		channelLanes[plan.near].push({
			plan: index,
			end: 'near',
			order: Math.min(from.x, gutter ?? to.x)
		});
		if (plan.shape === 'detour') {
			channelLanes[plan.far].push({
				plan: index,
				end: 'far',
				order: Math.min(to.x, gutter as number)
			});
		}
	});

	channelLanes.forEach((lanes, channel) => {
		lanes.sort((a, b) => a.order - b.order);
		lanes.forEach((lane, index) => {
			laneY[lane.plan][lane.end] = Math.round(
				channelY[channel] + (channelHeight[channel] * (index + 1)) / (lanes.length + 1)
			);
		});
	});

	const gutterLanes: Lane[][] = gutterWidth.map(() => []);
	plans.forEach((plan, index) => {
		if (plan.gutter === null) return;

		gutterLanes[plan.gutter].push({
			plan: index,
			end: 'near',
			order:
				plan.shape === 'sideways'
					? Math.min(ports[index].from.y, ports[index].to.y)
					: Math.min(laneY[index].near, laneY[index].far)
		});
	});

	gutterLanes.forEach((lanes, gutter) => {
		lanes.sort((a, b) => a.order - b.order);
		lanes.forEach((lane, index) => {
			laneX[lane.plan] = Math.round(
				gutterX[gutter] + (gutterWidth[gutter] * (index + 1)) / (lanes.length + 1)
			);
		});
	});

	const edges: LaidOutEdge[] = plans.map((plan, index) => {
		const { from, to } = ports[index];
		let points: Point[];

		if (plan.shape === 'sideways') {
			const jog = laneX[index];
			points = [from, { x: jog, y: from.y }, { x: jog, y: to.y }, to];
		} else if (plan.shape === 'hop') {
			const lane = laneY[index].near;
			points = [from, { x: from.x, y: lane }, { x: to.x, y: lane }, to];
		} else {
			const near = laneY[index].near;
			const far = laneY[index].far;
			const gutter = laneX[index];
			points = [
				from,
				{ x: from.x, y: near },
				{ x: gutter, y: near },
				{ x: gutter, y: far },
				{ x: to.x, y: far },
				to
			];
		}

		points = simplify(points);
		const last = points[points.length - 1];

		return {
			from: plan.relation.from,
			to: plan.relation.to,
			kind: plan.relation.kind,
			points,
			path: edgePath(points),
			x1: points[0].x,
			y1: points[0].y,
			x2: last.x,
			y2: last.y
		};
	});

	return { width, height, bands, boxes, edges };
}
