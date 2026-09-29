<script lang="ts">
	interface Box {
		id: string;
		name: string;
		lines: string[];
		type: string;
		layer: string;
		chapter: string;
		x: number;
		y: number;
		width: number;
		height: number;
	}

	interface Edge {
		from: string;
		to: string;
		kind: string;
		path: string;
		x1: number;
		y1: number;
		x2: number;
		y2: number;
	}

	interface Band {
		layer: string;
		label: string;
		x: number;
		y: number;
		width: number;
		height: number;
	}

	let {
		diagram,
		projectId,
		exportHref
	}: {
		diagram: { width: number; height: number; bands: Band[]; boxes: Box[]; edges: Edge[] };
		projectId: number;
		exportHref?: string;
	} = $props();

	// ArchiMate's own layer colours. Anyone who has seen an ArchiMate model reads
	// the layers from the fill without being told, so inventing a palette here
	// would cost recognition for nothing. The same three appear as RGB triplets in
	// `server/llm/archimate.ts`, which is what the exchange format wants.
	const FILL: Record<string, string> = {
		business: '#ffffb5',
		application: '#b5ffff',
		technology: '#c9e7b7'
	};
	const STROKE: Record<string, string> = {
		business: '#a2963a',
		application: '#4a9199',
		technology: '#67955a'
	};

	const LINE = '#4a5a52';

	// Behaviour is drawn with rounded corners and structure with square ones, as
	// every ArchiMate tool does — so the shape carries meaning before the icon is
	// even looked at.
	const ROUNDED = new Set(['service']);

	// Notation: solid for structure and support, dotted where something is read or
	// written, dashed where information moves. Arrowheads follow suit — filled for
	// assignment and flow, open for serving.
	const DASH: Record<string, string> = {
		assigned: '',
		serves: '',
		accesses: '1.5 3',
		flow: '7 4'
	};
	const HEAD: Record<string, string> = {
		assigned: 'url(#am-solid)',
		serves: 'url(#am-open)',
		accesses: 'url(#am-thin)',
		flow: 'url(#am-solid)'
	};

	const TYPE_LABEL: Record<string, string> = {
		actor: 'who',
		process: 'process',
		service: 'capability',
		data: 'information',
		system: 'system',
		infrastructure: 'runs on'
	};

	const STEPS = [0.4, 0.5, 0.65, 0.8, 1, 1.25, 1.5, 2, 2.5, 3];

	let hovered = $state<string | null>(null);
	let zoom = $state(1);
	let expanded = $state(false);
	let scroller = $state<HTMLDivElement | undefined>(undefined);

	// Everything the hovered box touches, so the rest can fade back and one
	// relation can be followed at a time.
	const linked = $derived(
		new Set(
			hovered === null
				? []
				: diagram.edges
						.filter((edge) => edge.from === hovered || edge.to === hovered)
						.flatMap((edge) => [edge.from, edge.to])
		)
	);

	function touches(edge: Edge): boolean {
		return hovered !== null && (edge.from === hovered || edge.to === hovered);
	}

	function faded(id: string): boolean {
		return hovered !== null && id !== hovered && !linked.has(id);
	}

	// Whether the zoom is the user's choice. A window resize re-fits a diagram that
	// was left fitted, and leaves alone one the user set deliberately — having a
	// chosen zoom thrown away by a resize is worse than a diagram that no longer
	// quite fills the frame.
	let chosen = false;

	function fit() {
		chosen = false;
		if (!scroller) return;

		// Both dimensions: fitting the width alone pushed the bottom layer out of
		// sight, and a diagram of three layers showing two is not fitted. The canvas
		// is a fixed height for this reason — measuring a box that grows with its own
		// contents would make the fit chase itself.
		const across = scroller.clientWidth - 8;
		const down = scroller.clientHeight - 8;
		if (across <= 0 || down <= 0) return;

		zoom = Math.min(2, Math.max(0.25, Math.min(across / diagram.width, down / diagram.height)));
	}

	function step(direction: 1 | -1) {
		const next = STEPS.filter((level) => (direction > 0 ? level > zoom + 0.01 : level < zoom - 0.01));
		if (next.length === 0) return;
		chosen = true;
		zoom = direction > 0 ? next[0] : next[next.length - 1];
	}

	function actualSize() {
		chosen = true;
		zoom = 1;
	}

	function onResize() {
		if (!chosen) fit();
	}

	function toggleExpanded() {
		expanded = !expanded;
	}

	function onWheel(event: WheelEvent) {
		if (!event.ctrlKey && !event.metaKey) return;
		event.preventDefault();
		step(event.deltaY < 0 ? 1 : -1);
	}

	function onKey(event: KeyboardEvent) {
		if (event.key === 'Escape' && expanded) {
			expanded = false;
			return;
		}
		if (!expanded) return;
		if (event.key === '+' || event.key === '=') step(1);
		else if (event.key === '-') step(-1);
		else if (event.key === '0') fit();
	}

	// Dragging to pan, which is how a large diagram is read once it is zoomed in.
	// A drag that happens to end on a box must not also open its chapter, so a
	// moved pointer swallows the click that follows it.
	let panning = $state(false);
	let dragged = false;
	let origin = { x: 0, y: 0, left: 0, top: 0 };

	function onPointerDown(event: PointerEvent) {
		if (event.button !== 0 || !scroller) return;
		panning = true;
		dragged = false;
		origin = {
			x: event.clientX,
			y: event.clientY,
			left: scroller.scrollLeft,
			top: scroller.scrollTop
		};
	}

	function onPointerMove(event: PointerEvent) {
		if (!panning || !scroller) return;
		const dx = event.clientX - origin.x;
		const dy = event.clientY - origin.y;
		if (!dragged && Math.abs(dx) + Math.abs(dy) < 5) return;
		dragged = true;
		scroller.scrollLeft = origin.left - dx;
		scroller.scrollTop = origin.top - dy;
	}

	function onPointerUp() {
		panning = false;
	}

	function onClickCapture(event: MouseEvent) {
		if (!dragged) return;
		event.preventDefault();
		event.stopPropagation();
		dragged = false;
	}

	// Panning and zooming are bound here rather than in the markup: they are
	// gestures on a scroll container, not interactions with a control, and giving
	// the container an ARIA role it does not have to satisfy a lint rule would be
	// worse than wiring it up directly. Wheel has to be non-passive to be able to
	// hold on to a ctrl-scroll.
	$effect(() => {
		const element = scroller;
		if (!element) return;

		element.addEventListener('pointerdown', onPointerDown);
		element.addEventListener('pointermove', onPointerMove);
		element.addEventListener('pointerup', onPointerUp);
		element.addEventListener('pointerleave', onPointerUp);
		element.addEventListener('click', onClickCapture, { capture: true });
		element.addEventListener('wheel', onWheel, { passive: false });

		return () => {
			element.removeEventListener('pointerdown', onPointerDown);
			element.removeEventListener('pointermove', onPointerMove);
			element.removeEventListener('pointerup', onPointerUp);
			element.removeEventListener('pointerleave', onPointerUp);
			element.removeEventListener('click', onClickCapture, { capture: true });
			element.removeEventListener('wheel', onWheel);
		};
	});

	// Fit on first render, and again whenever the room available changes — a redraw
	// of a different size, or going in and out of full screen. It has to be an
	// effect rather than a callback beside `expanded = !expanded`: the frame is
	// measured, and only an effect is guaranteed to run after the DOM has caught
	// up with the change.
	let lastWidth = 0;
	let lastExpanded = false;
	$effect(() => {
		const width = diagram.width;
		const full = expanded;
		if (!scroller) return;
		if (width === lastWidth && full === lastExpanded) return;

		const redrawn = width !== lastWidth;
		lastWidth = width;
		lastExpanded = full;
		if (redrawn || !chosen) fit();
	});
</script>

<svelte:window onkeydown={onKey} onresize={onResize} />

{#snippet glyph(type: string, colour: string)}
	<g fill="none" stroke={colour} stroke-width="1.3" stroke-linejoin="round">
		{#if type === 'actor'}
			<circle cx="8" cy="4.2" r="2.7" />
			<path d="M2.4 15 v-2.2 a5.6 5.6 0 0 1 11.2 0 V15" />
		{:else if type === 'process'}
			<path d="M1 5.6 H8.6 V2.4 L15 8 l-6.4 5.6 V10.4 H1 z" />
		{:else if type === 'service'}
			<rect x="1" y="4.2" width="14" height="7.6" rx="3.8" />
		{:else if type === 'data'}
			<rect x="1.4" y="3" width="13.2" height="10" />
			<path d="M1.4 6.2 H14.6" />
		{:else if type === 'infrastructure'}
			<path d="M1.4 6 L4.4 3 H14.6 v7.2 l-3 3 H1.4 z" />
			<path d="M1.4 6 H11.6 v7.2" />
			<path d="M11.6 6 L14.6 3" />
		{:else}
			<rect x="4.4" y="2.6" width="10.2" height="10.8" />
			<rect x="1.4" y="4.8" width="5" height="2.4" />
			<rect x="1.4" y="9" width="5" height="2.4" />
		{/if}
	</g>
{/snippet}

<div class="frame" class:expanded>
	<div class="tools">
		<div class="group">
			<button type="button" onclick={() => step(-1)} aria-label="Zoom out" title="Zoom out">−</button>
			<span class="level">{Math.round(zoom * 100)}%</span>
			<button type="button" onclick={() => step(1)} aria-label="Zoom in" title="Zoom in">+</button>
		</div>
		<button type="button" onclick={fit}>Fit</button>
		<button type="button" onclick={actualSize}>Actual size</button>
		<span class="spacer"></span>
		{#if exportHref}
			<a class="download" href={exportHref} download
				>Download for Archi<span class="hint">ArchiMate exchange file</span></a
			>
		{/if}
		<button type="button" class="wide" onclick={toggleExpanded}>
			{expanded ? 'Close full screen' : 'Full screen'}
		</button>
	</div>

	<div class="scroll" class:grabbing={panning} bind:this={scroller}>
		<svg
			width={Math.round(diagram.width * zoom)}
			height={Math.round(diagram.height * zoom)}
			viewBox="0 0 {diagram.width} {diagram.height}"
			role="img"
			aria-label="Layered diagram of the application"
		>
			<defs>
				<marker
					id="am-solid"
					viewBox="0 0 9 8"
					refX="8.5"
					refY="4"
					markerWidth="9"
					markerHeight="8"
					markerUnits="userSpaceOnUse"
					orient="auto"
				>
					<path d="M0 0.6 L9 4 L0 7.4 z" fill={LINE} />
				</marker>
				<marker
					id="am-open"
					viewBox="0 0 10 9"
					refX="9.5"
					refY="4.5"
					markerWidth="10"
					markerHeight="9"
					markerUnits="userSpaceOnUse"
					orient="auto"
				>
					<path d="M0.6 0.6 L9.4 4.5 L0.6 8.4" fill="none" stroke={LINE} stroke-width="1.2" />
				</marker>
				<marker
					id="am-thin"
					viewBox="0 0 8 7"
					refX="7.5"
					refY="3.5"
					markerWidth="8"
					markerHeight="7"
					markerUnits="userSpaceOnUse"
					orient="auto"
				>
					<path d="M0.6 0.6 L7.4 3.5 L0.6 6.4" fill="none" stroke={LINE} stroke-width="1.1" />
				</marker>
				<marker
					id="am-ball"
					viewBox="0 0 8 8"
					refX="4"
					refY="4"
					markerWidth="8"
					markerHeight="8"
					markerUnits="userSpaceOnUse"
					orient="auto"
				>
					<circle cx="4" cy="4" r="2.6" fill={LINE} />
				</marker>
			</defs>

			{#each diagram.bands as band (band.layer)}
				<rect
					x={band.x}
					y={band.y}
					width={band.width}
					height={band.height}
					rx="6"
					fill={FILL[band.layer]}
					fill-opacity="0.28"
					stroke={STROKE[band.layer]}
					stroke-opacity="0.3"
					stroke-dasharray="4 4"
				/>
				<text x={band.x + 14} y={band.y + 21} class="band-label" fill={STROKE[band.layer]}
					>{band.label}</text
				>
			{/each}

			{#each diagram.boxes as box (box.id)}
				<a href={box.chapter ? `/projects/${projectId}?chapter=${box.chapter}` : undefined}>
					<g
						role="listitem"
						opacity={faded(box.id) ? 0.35 : 1}
						onmouseenter={() => (hovered = box.id)}
						onmouseleave={() => (hovered = null)}
					>
						<title>{box.name} — {TYPE_LABEL[box.type] ?? box.type}</title>
						<rect
							x={box.x}
							y={box.y}
							width={box.width}
							height={box.height}
							rx={ROUNDED.has(box.type) ? 15 : 3}
							fill={FILL[box.layer]}
							stroke={STROKE[box.layer]}
							stroke-width={hovered === box.id ? 2.2 : 1.2}
						/>
						<g transform="translate({box.x + box.width - 26}, {box.y + 9})">
							{@render glyph(box.type, STROKE[box.layer])}
						</g>
						{#each box.lines as line, index}
							<text
								x={box.x + box.width / 2}
								y={box.y + 26 + (58 - box.lines.length * 15) / 2 + 11 + index * 15}
								class="name">{line}</text
							>
						{/each}
					</g>
				</a>
			{/each}

			<!--
				Drawn after the boxes so an end decoration is not half-buried under the
				box it belongs to — the ball on an assignment sits on the border, and
				under the box it read as a line with nothing on the end. Nothing is lost
				by this: no route passes over a box, only up to its border. Pointer
				events stay off so a line lying against a border cannot swallow the
				click meant for the box.
			-->
			<g pointer-events="none">
				{#each diagram.edges as edge (edge.from + edge.to + edge.kind)}
					<g opacity={hovered !== null && !touches(edge) ? 0.13 : 1}>
						<path
							d={edge.path}
							fill="none"
							stroke={LINE}
							stroke-width={touches(edge) ? 2 : 1.2}
							stroke-dasharray={DASH[edge.kind] ?? ''}
							marker-start={edge.kind === 'assigned' ? 'url(#am-ball)' : undefined}
							marker-end={HEAD[edge.kind] ?? 'url(#am-solid)'}
						/>
					</g>
				{/each}
			</g>
		</svg>
	</div>
</div>

<style>
	.frame {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		overflow: hidden;
	}

	.frame.expanded {
		position: fixed;
		inset: 12px;
		z-index: 60;
		box-shadow: 0 24px 60px rgba(0, 0, 0, 0.28);
		display: flex;
		flex-direction: column;
	}

	.tools {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 9px;
		border-bottom: 1px solid var(--line);
		background: var(--panel-soft, rgba(0, 0, 0, 0.02));
		flex-wrap: wrap;
	}

	.group {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.spacer {
		flex: 1;
	}

	button,
	.download {
		font: inherit;
		font-size: 12px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 4px 9px;
		color: var(--ink);
		cursor: pointer;
		text-decoration: none;
		white-space: nowrap;
	}

	button:hover,
	.download:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.group button {
		width: 27px;
		padding: 4px 0;
		text-align: center;
		font-size: 14px;
		line-height: 1;
	}

	.level {
		font-size: 11px;
		color: var(--ink-soft);
		width: 42px;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}

	.hint {
		display: block;
		font-size: 10px;
		color: var(--ink-soft);
	}

	.download:hover .hint {
		color: inherit;
	}

	.scroll {
		overflow: auto;
		padding: 4px;
		cursor: grab;
		height: 72vh;
		min-height: 360px;
	}

	.expanded .scroll {
		flex: 1;
		height: auto;
	}

	.scroll.grabbing {
		cursor: grabbing;
	}

	svg {
		display: block;
		/* Centred while it is narrower than the canvas. Auto margins resolve to zero
		   once it is wider, so a zoomed-in diagram still scrolls from its left edge
		   instead of having the start cut off, which is what flex centring does. */
		margin: 0 auto;
	}

	.band-label {
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.09em;
	}

	.name {
		font-size: 12px;
		fill: #24312b;
		text-anchor: middle;
	}

	a {
		cursor: pointer;
	}

	a:hover .name {
		text-decoration: underline;
	}
</style>
