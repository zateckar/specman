<script lang="ts">
	import ArchitectureDiagram from '$lib/components/ArchitectureDiagram.svelte';

	let { data } = $props();

	// A fresh drawing overrides what the page loaded with; until then, and after
	// any navigation that reloads the data, the stored one is shown.
	let drawn = $state<{ diagram: typeof data.diagram; createdAt: string } | null>(null);
	const diagram = $derived(drawn?.diagram ?? data.diagram);
	const createdAt = $derived(drawn?.createdAt ?? data.model?.created_at ?? null);
	let busy = $state(false);
	let errorMessage = $state('');

	async function derive() {
		busy = true;
		errorMessage = '';
		try {
			const response = await fetch('/api/architecture', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ projectId: data.project.id })
			});
			const result = await response.json().catch(() => null);
			// A failed drawing leaves the previous picture where it was.
			if (!response.ok) {
				errorMessage =
					result?.message ?? 'The diagram could not be drawn just now. Try again in a minute.';
				return;
			}
			drawn = { diagram: result.diagram, createdAt: new Date().toISOString() };
		} catch {
			errorMessage = 'The diagram could not be drawn just now. Try again in a minute.';
		} finally {
			busy = false;
		}
	}
</script>

<main>
	<a class="back" href="/projects/{data.project.id}">← Back to {data.project.name}</a>

	<div class="head">
		<div>
			<h1>How it fits together</h1>
			<p class="sub">
				{#if createdAt}
					Drawn from the document as it stood on {new Date(createdAt).toLocaleString()}. Hover a
					box to pick out what it connects to; click one to open the chapter it came from.
				{:else}
					The three layers of the application: who is involved, what it does and holds, and what
					it sits on. Drawn from what the document says — nothing is invented.
				{/if}
			</p>
		</div>
		<button class="primary" onclick={derive} disabled={busy}>
			{busy ? 'Drawing…' : createdAt ? 'Draw again' : 'Draw the diagram'}
		</button>
	</div>

	{#if errorMessage}
		<p class="error" role="alert">{errorMessage}</p>
	{/if}

	{#if diagram && diagram.boxes.length > 0}
		<ArchitectureDiagram
			{diagram}
			projectId={data.project.id}
			exportHref="/projects/{data.project.id}/diagram/export"
		/>

		<div class="key">
			<span><i class="swatch business"></i> Business — who is involved and what they do</span>
			<span><i class="swatch application"></i> Application — what it offers and holds</span>
			<span><i class="swatch technology"></i> Technology — systems and what it runs on</span>
		</div>
		<div class="key lines">
			<span><i class="line solid"></i> carries out</span>
			<span><i class="line solid open"></i> supports</span>
			<span><i class="line dotted"></i> reads or writes</span>
			<span><i class="line dashed"></i> information passes to</span>
			<span><i class="pill"></i> a rounded box is a capability</span>
		</div>
	{:else if !busy}
		<div class="empty">
			<p>No diagram yet.</p>
			<p class="sub">
				It is drawn from the chapters and the rules in them, so there needs to be something
				written down first.
			</p>
		</div>
	{/if}
</main>

<style>
	main {
		padding: 24px;
		max-width: 1320px;
		/* The layout is a flex column, so without this the page shrinks to its
		   widest sentence and the diagram is given a fraction of the window. */
		width: 100%;
		box-sizing: border-box;
		margin: 0 auto;
	}

	.back {
		font-size: 13px;
		text-decoration: none;
	}

	.head {
		display: flex;
		align-items: flex-start;
		gap: 20px;
		margin: 10px 0 18px;
	}

	.head > div {
		flex: 1;
	}

	h1 {
		font-size: 21px;
		margin: 0 0 6px;
	}

	.sub {
		font-size: 13px;
		color: var(--ink-soft);
		margin: 0;
		max-width: 620px;
	}

	.primary {
		background: var(--accent);
		color: #fff;
		border: 0;
		border-radius: 8px;
		padding: 9px 16px;
		font-weight: 600;
		white-space: nowrap;
	}

	.primary:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.key {
		display: flex;
		flex-wrap: wrap;
		gap: 18px;
		margin-top: 14px;
		font-size: 12px;
		color: var(--ink-soft);
	}

	.key span {
		display: flex;
		align-items: center;
		gap: 7px;
	}

	.swatch {
		width: 13px;
		height: 13px;
		border-radius: 3px;
		border: 1px solid rgba(0, 0, 0, 0.18);
	}

	.swatch.business {
		background: #ffffb5;
	}

	.swatch.application {
		background: #b5ffff;
	}

	.swatch.technology {
		background: #c9e7b7;
	}

	.lines {
		margin-top: 7px;
	}

	.line {
		width: 24px;
		height: 0;
		border-top: 1.5px solid #4a5a52;
		position: relative;
	}

	/* The arrowheads of the legend, matching the notation in the picture. */
	.line::after {
		content: '';
		position: absolute;
		right: -1px;
		top: -3.5px;
		border: 3.5px solid transparent;
		border-left-color: #4a5a52;
		border-right-width: 0;
	}

	.line.open::after {
		border-left-color: transparent;
		width: 5px;
		height: 7px;
		border: 0;
		top: -4px;
		border-top: 1.5px solid #4a5a52;
		border-right: 1.5px solid #4a5a52;
		transform: rotate(45deg);
		transform-origin: right center;
	}

	.line.dotted {
		border-top-style: dotted;
	}

	.line.dashed {
		border-top-style: dashed;
	}

	.pill {
		width: 22px;
		height: 12px;
		border-radius: 6px;
		border: 1px solid #4a9199;
		background: #b5ffff;
	}

	.error {
		background: var(--warn-soft);
		border: 1px solid #eddcb8;
		color: #6f4a0d;
		padding: 9px 12px;
		border-radius: 8px;
		font-size: 13px;
	}

	.empty {
		border: 1px dashed var(--line);
		border-radius: var(--radius);
		padding: 30px;
		text-align: center;
		color: var(--ink-soft);
	}

	.empty p {
		margin: 0;
	}
</style>
