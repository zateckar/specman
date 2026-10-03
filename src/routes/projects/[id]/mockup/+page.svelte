<script lang="ts">
	let { data } = $props();

	// Polled while a mock-up is being made; reset by any navigation that reloads.
	let view = $derived(data.view);
	let busy = $state(false);
	let errorMessage = $state('');
	/** It was being made, and stopped with nothing new and no reason: the server restarted. */
	let interrupted = $state(false);
	let width = $state<'laptop' | 'phone'>('laptop');
	let stage = $state<HTMLDivElement>();
	let canFullScreen = $state(false);

	const base = $derived(`/projects/${data.project.id}/mockup`);
	// A new mock-up has a new time, so the frame loads it rather than the cached one.
	const frameSrc = $derived(view.made ? `${base}/view?made=${encodeURIComponent(view.made.createdAt ?? '')}` : '');
	const kilobytes = $derived(Math.max(1, Math.round(view.written / 1024)));

	$effect(() => {
		canFullScreen = document.fullscreenEnabled;
	});

	function fullScreen() {
		stage?.requestFullscreen().catch(() => {});
	}

	async function stop() {
		try {
			const response = await fetch(`/api/mockup?project=${data.project.id}`, { method: 'DELETE' });
			if (response.ok) view = await response.json();
		} catch {
			errorMessage = 'It could not be stopped just now. Try again in a moment.';
		}
	}

	async function make() {
		busy = true;
		errorMessage = '';
		interrupted = false;
		try {
			const response = await fetch('/api/mockup', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ projectId: data.project.id })
			});
			const result = await response.json().catch(() => null);
			if (!response.ok) {
				errorMessage = result?.message ?? 'The mock-up could not be started just now. Try again in a minute.';
				return;
			}
			view = result;
		} catch {
			errorMessage = 'The mock-up could not be started just now. Try again in a minute.';
		} finally {
			busy = false;
		}
	}

	// One request at a time, a few seconds apart, for as long as one is being made.
	$effect(() => {
		if (!view.running) return;
		const timer = setTimeout(async () => {
			try {
				const response = await fetch(`/api/mockup?project=${data.project.id}`);
				if (!response.ok) throw new Error(String(response.status));
				const next = await response.json();
				interrupted =
					!next.running && !next.problem && next.made?.createdAt === view.made?.createdAt;
				view = next;
			} catch {
				// The next look will tell; a missed one changes nothing.
				view = { ...view };
			}
		}, 3000);
		return () => clearTimeout(timer);
	});
</script>

<svelte:head><title>Mock-up — {data.project.name} — Specman</title></svelte:head>

<main>
	<a class="back" href="/projects/{data.project.id}">← Back to {data.project.name}</a>

	<div class="head">
		<div>
			<h1>What it might look like</h1>
			<p class="sub">
				One way {data.project.name} could look, made up by the assistant from the document with
				invented sample data. It is something to react to, not a design anyone has agreed: say
				what is wrong in the conversation, because the document is what gets built. It is a
				sketch, so do not type anything real into it.
			</p>
		</div>
		{#if view.running}
			<button class="secondary" onclick={stop}>Stop</button>
		{:else}
			<button class="primary" onclick={make} disabled={busy || data.drafting || !data.canMake}>
				{view.made ? 'Make it again' : 'Make a mock-up'}
			</button>
		{/if}
	</div>

	<div class="status" role="status">
		{#if view.running}
			<p class="progress">
				{#if view.retrying}The first attempt could not be used, so the assistant is trying once more, smaller.{/if}
				{view.phase === 'writing'
					? `Writing the page — ${kilobytes} KB so far…`
					: view.phase === 'waiting'
						? 'Waiting for the assistant, which is busy with other long work…'
						: view.phase === 'planning'
							? 'The assistant is deciding which screens to show…'
							: 'The assistant is working out how the page will look…'}
				This takes several minutes; you can leave this page and come back.
			</p>
		{:else if interrupted}
			<p class="note">It stopped before it was finished, perhaps because the server restarted. Make it again.</p>
		{/if}
	</div>

	{#if data.drafting}
		<p class="note">The assistant is still drafting this document. Make a mock-up once it has finished.</p>
	{:else if !data.canMake}
		<p class="note">The assistant is not available here, so it cannot make a mock-up.</p>
	{/if}

	{#if errorMessage || view.problem}
		<p class="error" role="alert">{errorMessage || view.problem}</p>
	{/if}

	{#if view.made}
		{#if view.made.stale}
			<p class="note">The document has changed since this was made. Make it again to see the changes.</p>
		{/if}
		{#if view.made.incomplete}
			<p class="note">
				Parts of it were meant to come from the internet, which it cannot reach here, so some of it
				may be missing. Making it again may help.
			</p>
		{/if}

		<div class="toolbar">
			<div class="sizes" role="group" aria-label="Width">
				<button aria-pressed={width === 'laptop'} onclick={() => (width = 'laptop')}>Laptop</button>
				<button aria-pressed={width === 'phone'} onclick={() => (width = 'phone')}>Phone</button>
			</div>
			{#if view.made.createdAt}
				<span class="made">Made {new Date(view.made.createdAt).toLocaleString()}</span>
			{/if}
			<span class="spacer"></span>
			{#if canFullScreen}<button class="link" onclick={fullScreen}>Full screen</button>{/if}
			<a href="{base}/download" download>Download — a file that opens in any web browser</a>
		</div>

		<div class="stage" class:phone={width === 'phone'} bind:this={stage}>
			<iframe
				title="Mock-up of {data.project.name}"
				src={frameSrc}
				sandbox={data.sandbox}
				referrerpolicy="no-referrer"
			></iframe>
		</div>
	{:else if !view.running}
		<div class="empty">
			<p>No mock-up yet.</p>
			<p class="sub">
				It is made from the chapters written so far, so there needs to be something written down
				first. Making one takes several minutes.
			</p>
		</div>
	{/if}
</main>

<style>
	main {
		padding: 24px;
		max-width: 1320px;
		/* The layout is a flex column; without this the page shrinks to its widest sentence. */
		width: 100%;
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
		margin: 10px 0 12px;
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
		max-width: 660px;
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

	.secondary {
		background: var(--panel);
		color: var(--ink);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 8px 16px;
		white-space: nowrap;
	}

	.link {
		background: none;
		border: 0;
		padding: 0;
		color: var(--accent);
		text-decoration: underline;
	}

	.progress {
		background: var(--accent-soft);
		border-radius: 8px;
		padding: 9px 12px;
		font-size: 13px;
		margin: 0 0 12px;
	}

	.note,
	.error {
		background: var(--warn-soft);
		border: 1px solid #eddcb8;
		color: #6f4a0d;
		padding: 9px 12px;
		border-radius: 8px;
		font-size: 13px;
		margin: 0 0 12px;
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 16px;
		margin-bottom: 10px;
		font-size: 13px;
	}

	.sizes {
		display: inline-flex;
		border: 1px solid var(--line);
		border-radius: 8px;
		overflow: hidden;
	}

	.sizes button {
		background: var(--panel);
		border: 0;
		padding: 5px 12px;
		color: var(--ink-soft);
	}

	.sizes button + button {
		border-left: 1px solid var(--line);
	}

	.sizes button[aria-pressed='true'] {
		background: var(--accent-soft);
		color: var(--accent);
		font-weight: 600;
	}

	.made {
		color: var(--ink-soft);
	}

	.spacer {
		flex: 1;
	}

	.stage {
		display: flex;
		justify-content: center;
		background: #e9ecea;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 12px;
	}

	iframe {
		width: 100%;
		height: min(78vh, 900px);
		border: 1px solid var(--line);
		border-radius: 6px;
		background: #fff;
	}

	/* A common phone's width in CSS pixels. */
	.stage.phone iframe {
		width: 390px;
		max-width: 100%;
		height: min(78vh, 844px);
		border-radius: 18px;
		border-width: 6px;
		border-color: #2b322f;
	}

	.stage:fullscreen {
		align-items: center;
		border: 0;
		border-radius: 0;
		padding: 0;
	}

	.stage:fullscreen iframe {
		height: 100%;
		border: 0;
		border-radius: 0;
	}

	.stage.phone:fullscreen iframe {
		height: min(100%, 844px);
		border: 6px solid #2b322f;
		border-radius: 18px;
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
