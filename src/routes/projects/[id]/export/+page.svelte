<script lang="ts">
	let { data } = $props();

	let copied = $state(false);
	let copyNote = $state('');
	let preview: HTMLPreElement | undefined = $state();

	const errors = $derived(data.problems.filter((p) => p.severity === 'error'));
	const warnings = $derived(data.problems.filter((p) => p.severity === 'warning'));

	/**
	 * The clipboard API exists only on a secure page, and is refused when the
	 * browser says no — in both cases the button used to do nothing at all, with
	 * no word of it. The older copy command works over plain http; failing that,
	 * the text is selected so the user can copy it themselves, and told so.
	 */
	async function copy() {
		copyNote = '';
		try {
			await navigator.clipboard.writeText(data.single);
			copied = true;
		} catch {
			copied = selectPreview() && document.execCommand('copy');
			if (!copied) copyNote = 'Copying was blocked by the browser. The text is selected below — press Ctrl+C to copy it.';
		}
		if (copied) setTimeout(() => (copied = false), 2500);
	}

	function selectPreview(): boolean {
		if (!preview) return false;
		const range = document.createRange();
		range.selectNodeContents(preview);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
		return true;
	}
</script>

<svelte:head><title>Hand to a developer — {data.project.name} — Specman</title></svelte:head>

<main>
	<a class="back" href="/projects/{data.project.id}">← Back to {data.project.name}</a>
	<h1>Hand this to a developer</h1>

	<p class="lead">
		The same document, rewritten for whoever builds it: what must be true, what must not be
		built, and who decided each thing. It is written into the application's repository under
		<code>spec/</code> whenever changes are approved, so anyone who clones it gets the approved
		version.
	</p>
	<!-- The preview is built from the document as it stands, which can be ahead of
	     what was approved; the page used to read as though they were the same. -->
	<p class="lead">
		What you copy here is the document as it stands now, including anything not yet approved.
	</p>

	<div class="card summary">
		<div>
			<strong>{data.requirementCount} requirement{data.requirementCount === 1 ? '' : 's'} in scope</strong>
			<p class="sub">{data.files.length} files under <code>spec/</code></p>
		</div>
		<button class="primary" onclick={copy}>
			{copied ? 'Copied' : 'Copy it all'}
		</button>
	</div>
	<p class="copy-note" role="status">{copied ? 'Copied to the clipboard.' : copyNote}</p>

	{#if errors.length > 0 || data.openQuestions > 0 || data.unconfirmed > 0}
		<div class="card caveats">
			<h2>Worth fixing first</h2>
			<p class="sub">
				None of this stops you handing it over — the caveats are written at the top of
				<code>AGENTS.md</code> so whoever builds it sees them. But each one is somewhere a
				builder will have to guess.
			</p>
			<ul>
				{#each errors as problem}
					<li class="error">{problem.message}</li>
				{/each}
				{#if data.openQuestions > 0}
					<li>
						{data.openQuestions} question{data.openQuestions === 1 ? '' : 's'} still unanswered
					</li>
				{/if}
				{#if data.unconfirmed > 0}
					<li>
						{data.unconfirmed} decision{data.unconfirmed === 1 ? ' was' : 's were'} made for you
						and never confirmed
					</li>
				{/if}
				{#each warnings.slice(0, 4) as problem}
					<li>{problem.message}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<h2>What it looks like</h2>
	<pre class="card preview" bind:this={preview}>{data.single}</pre>
</main>

<style>
	main {
		padding: 24px;
		max-width: 820px;
		margin: 0 auto;
	}

	.back {
		font-size: 13px;
		text-decoration: none;
	}

	h1 {
		font-size: 21px;
		margin: 10px 0 10px;
	}

	h2 {
		font-size: 15px;
		margin: 24px 0 10px;
	}

	.lead {
		font-size: 13.5px;
		color: var(--ink-soft);
		max-width: 640px;
		margin: 0 0 18px;
	}

	.card {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 16px;
	}

	.summary {
		display: flex;
		align-items: center;
		gap: 16px;
		margin-bottom: 14px;
	}

	.summary > div {
		flex: 1;
	}

	.sub {
		font-size: 13px;
		color: var(--ink-soft);
		margin: 3px 0 0;
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

	.caveats h2 {
		margin: 0 0 6px;
	}

	.caveats ul {
		margin: 12px 0 0;
		padding-left: 20px;
		font-size: 13.5px;
	}

	.caveats li {
		margin-bottom: 4px;
	}

	.caveats .error {
		color: #8c2020;
	}

	.copy-note {
		min-height: 1em;
		margin: -6px 0 12px;
		font-size: 12.5px;
		color: var(--ink-soft);
	}

	.preview {
		font-family: var(--mono);
		font-size: 12px;
		line-height: 1.55;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-height: 60vh;
		overflow-y: auto;
		margin: 0;
	}

	code {
		font-family: var(--mono);
		font-size: 12px;
		background: var(--bg);
		padding: 1px 4px;
		border-radius: 4px;
	}
</style>
