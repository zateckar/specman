<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';

	let { data, form } = $props();
	// Open again after a refused submit, so its message is seen and what was
	// typed is still there. It used to come back closed, with both hidden.
	let creating = $derived(!!form?.message);
	const typed = $derived((form?.values ?? {}) as Record<string, string>);
	let start = $derived(typed.start === 'draft' && data.canDraft ? 'draft' : 'interview');

	// Asked once more in the page rather than in a browser dialog, which a screen
	// reader handles badly. Focus goes to the button that deletes, and back to the
	// one that asked if the draft is kept.
	let confirming = $state<number | null>(null);
	const focusOnMount = (node: HTMLElement) => node.focus();
	async function keep(id: number) {
		confirming = null;
		await tick();
		document.getElementById(`delete-${id}`)?.focus();
	}

	// A draft takes minutes; its card counts the chapters as they land.
	const drafting = $derived(data.projects.some((p) => p.draft?.running));
	$effect(() => {
		if (!drafting) return;
		const timer = setInterval(() => invalidateAll(), 5000);
		return () => clearInterval(timer);
	});
</script>

<svelte:head><title>Your applications — Specman</title></svelte:head>

<main>
	<div class="head">
		<div>
			<h1>Your applications</h1>
			<p class="sub">
				Each application gets a design document. Answer the assistant's questions and it writes
				the document for you — or let it draft the whole thing as a starting point.
			</p>
		</div>
		<button class="primary" onclick={() => (creating = !creating)}>
			{creating ? 'Cancel' : 'New application'}
		</button>
	</div>

	{#if creating}
		<form method="POST" action="?/create" class="card new">
			{#if form?.message}<p class="error" role="alert">{form.message}</p>{/if}
			<label>
				What is it called?
				<input name="name" placeholder="Company car booking" required value={typed.name ?? ''} />
			</label>
			<!-- Nothing promises these can be changed later: nothing yet can change
			     them. A chapter the answers set aside can still be included from the
			     index, and the description is refined in the Overview chapter. -->
			<label>
				What should it do? {start === 'draft' ? '(a few sentences — the draft is written from this)' : '(a sentence or two)'}
				<textarea
					name="description"
					rows="3"
					maxlength="2000"
					required={start === 'draft'}
					placeholder="Let employees book a pool car for a day"
					value={typed.description ?? ''}
				></textarea>
			</label>

			<p class="triage-intro">
				Four quick answers so we only ask you about the things that matter for this
				application. If a chapter they leave out does apply, you can include it again later.
			</p>

			<label>
				Does it already exist?
				<select name="kind" value={typed.kind ?? 'new'}>
					<option value="new">No — this is something new</option>
					<option value="change">Yes — we want to change something we already have</option>
				</select>
			</label>

			<label>
				Who can get to it?
				<select name="reach" value={typed.reach ?? 'company'}>
					<option value="company">Anyone at Škoda Auto</option>
					<option value="team">Just my team</option>
					<option value="external">People outside the company too</option>
				</select>
			</label>

			<label>
				Does it hold anything about identifiable people — names, contact details, photographs?
				<select name="personalData" value={typed.personalData ?? 'yes'}>
					<option value="yes">Yes, or I am not sure</option>
					<option value="no">No, nothing about individual people</option>
				</select>
			</label>

			<label>
				Does it touch money, safety, or records the company is legally required to keep?
				<select name="critical" value={typed.critical ?? 'no'}>
					<option value="no">No</option>
					<option value="yes">Yes, or I am not sure</option>
				</select>
			</label>

			<fieldset class="start">
				<legend>How would you like to start?</legend>
				<label class="choice">
					<input type="radio" name="start" value="interview" bind:group={start} />
					<span>
						<strong>Answer the assistant's questions</strong>
						<span class="hint">It asks about one chapter at a time and writes down what you say.</span>
					</span>
				</label>
				<label class="choice" class:unavailable={!data.canDraft}>
					<input type="radio" name="start" value="draft" bind:group={start} disabled={!data.canDraft} />
					<span>
						<strong>Let the assistant draft all of it</strong>
						<span class="hint">
							{#if data.canDraft}
								It writes every chapter on its own and makes every choice for you, marked so you
								can check it. Use it as a starting point, keep what fits, or delete it.
							{:else}
								Not available here: the assistant is not set up.
							{/if}
						</span>
					</span>
				</label>
			</fieldset>

			<button type="submit" class="primary">{start === 'draft' ? 'Create and draft' : 'Create and start'}</button>
		</form>
	{/if}

	{#if data.projects.length === 0 && !creating}
		<div class="empty">
			<p>No applications yet.</p>
			<p class="sub">Create one and the assistant will start asking what you need, or draft it for you.</p>
		</div>
	{:else}
		<ul class="grid">
			{#each data.projects as project (project.id)}
				<!-- The whole card opens the application through a link stretched over it;
				     the delete control is its sibling, since a button inside a link is not
				     a button anyone can reach. -->
				<li class="card project">
					<h2><a class="open-link" href="/projects/{project.id}">{project.name}</a></h2>
					{#if project.draft?.untouched || project.draft?.running}
						<p class="marks">
							{#if project.draft.untouched}
								<span class="ai-draft" title="Written by the assistant on its own. Nobody has changed anything in it yet.">AI draft</span>
							{/if}
							{#if project.draft.running}
								<span class="drafting" role="status">
									Drafting… {project.draft.done} of {project.draft.total} chapters
								</span>
							{/if}
						</p>
					{/if}
					<p class="sub description">{project.description || 'No description yet'}</p>
					<div class="meter" aria-label="{project.complete} of {project.total} chapters complete">
						<div
							class="fill"
							style="width: {project.total ? (project.complete / project.total) * 100 : 0}%"
						></div>
					</div>
					<div class="stats">
						<span>{project.complete}/{project.total} chapters</span>
						{#if project.open > 0}
							<span class="open">{project.open} open question{project.open === 1 ? '' : 's'}</span>
						{/if}
					</div>

					{#if project.draft?.canDelete}
						<div class="delete">
							{#if confirming === project.id}
								<form method="POST" action="?/delete" use:enhance={() => {
									return async ({ update }) => {
										confirming = null;
										await update();
									};
								}}>
									<input type="hidden" name="project" value={project.id} />
									<span>Delete this draft for good?</span>
									<button type="submit" class="danger" use:focusOnMount>Delete</button>
									<button type="button" onclick={() => keep(project.id)}>Keep it</button>
								</form>
							{:else}
								<button type="button" id="delete-{project.id}" class="quiet" onclick={() => (confirming = project.id)}>
									Delete draft
								</button>
							{/if}
						</div>
					{/if}
					{#if form?.deleteMessage && form?.project === project.id}
						<p class="error delete-error" role="alert">{form.deleteMessage}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	main {
		flex: 1;
		overflow: auto;
		padding: 28px;
		max-width: 1000px;
		width: 100%;
		margin: 0 auto;
	}

	.head {
		display: flex;
		align-items: flex-start;
		gap: 16px;
		margin-bottom: 22px;
	}

	.head > div {
		flex: 1;
	}

	h1 {
		font-size: 22px;
	}

	.sub {
		color: var(--ink-soft);
		font-size: 14px;
		margin: 0;
	}

	.primary {
		background: var(--accent);
		color: #fff;
		border: 0;
		border-radius: 7px;
		padding: 9px 14px;
		font-weight: 600;
		white-space: nowrap;
	}

	.card {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 18px;
	}

	.new {
		margin-bottom: 22px;
		max-width: 520px;
	}

	label {
		display: block;
		font-size: 13px;
		color: var(--ink-soft);
		margin-bottom: 14px;
	}

	.triage-intro {
		font-size: 12.5px;
		color: var(--ink-soft);
		border-top: 1px solid var(--line);
		padding-top: 14px;
		margin: 0 0 14px;
	}

	select {
		display: block;
		width: 100%;
		margin-top: 4px;
		padding: 9px 10px;
		font: inherit;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--panel);
	}

	input {
		display: block;
		width: 100%;
		margin-top: 4px;
		padding: 9px 10px;
		font: inherit;
		border: 1px solid var(--line);
		border-radius: 7px;
	}

	input:focus {
		outline: 2px solid var(--accent);
		outline-offset: -1px;
	}

	.grid {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 14px;
	}

	.project {
		position: relative;
		display: flex;
		flex-direction: column;
	}

	.project:hover,
	.project:focus-within {
		border-color: var(--accent);
	}

	.project h2 {
		font-size: 16px;
		margin-bottom: 2px;
	}

	.open-link {
		color: inherit;
		text-decoration: none;
	}

	/* The link covers the card, so the whole card opens it. */
	.open-link::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: var(--radius);
	}

	.open-link:focus-visible {
		outline: none;
	}

	.open-link:focus-visible::after {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.marks {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin: 4px 0 6px;
		font-size: 12px;
	}

	/* The colours of "Decided for you" in the document: the assistant's, not yours. */
	.ai-draft {
		font-size: 10.5px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 2px 8px;
		border-radius: 10px;
		background: #f4f1fb;
		border: 1px solid #ddd4f0;
		color: #5b46a0;
	}

	.drafting {
		color: var(--ink-soft);
	}

	.description {
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	/* Above the stretched link, so it can be pressed. */
	.delete {
		position: relative;
		z-index: 1;
		margin-top: 12px;
		font-size: 12.5px;
	}

	.delete form {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.delete button {
		font: inherit;
		font-size: 12.5px;
		padding: 4px 10px;
		border-radius: 12px;
		border: 1px solid var(--line);
		background: var(--panel);
		color: var(--ink-soft);
	}

	.delete button.quiet:hover {
		border-color: #c98a8a;
		color: #8c2020;
	}

	.delete button.danger {
		background: #a32626;
		border-color: #a32626;
		color: #fff;
	}

	.delete-error {
		position: relative;
		z-index: 1;
		margin: 8px 0 0;
	}

	.start {
		border: 0;
		border-top: 1px solid var(--line);
		padding: 14px 0 0;
		margin: 0 0 16px;
	}

	.start legend {
		font-size: 13px;
		color: var(--ink-soft);
		padding: 0;
		margin-bottom: 8px;
	}

	.choice {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 9px 10px;
		border: 1px solid var(--line);
		border-radius: 8px;
		margin-bottom: 8px;
		color: var(--ink);
		cursor: pointer;
	}

	.choice:has(input:checked) {
		border-color: var(--accent);
		background: var(--accent-soft);
	}

	.choice.unavailable {
		cursor: default;
		opacity: 0.7;
	}

	.choice input {
		width: auto;
		margin: 3px 0 0;
	}

	.choice strong {
		display: block;
		font-size: 13.5px;
	}

	.hint {
		display: block;
		font-size: 12.5px;
		color: var(--ink-soft);
		margin-top: 2px;
	}

	textarea {
		display: block;
		width: 100%;
		margin-top: 4px;
		padding: 9px 10px;
		font: inherit;
		border: 1px solid var(--line);
		border-radius: 7px;
		resize: vertical;
	}

	textarea:focus {
		outline: 2px solid var(--accent);
		outline-offset: -1px;
	}

	.meter {
		height: 5px;
		background: var(--line);
		border-radius: 3px;
		margin: 14px 0 8px;
		overflow: hidden;
	}

	.fill {
		height: 100%;
		background: var(--accent);
	}

	.stats {
		display: flex;
		gap: 12px;
		font-size: 12px;
		color: var(--ink-soft);
	}

	.open {
		color: var(--warn);
	}

	.empty {
		text-align: center;
		padding: 60px 0;
		color: var(--ink-soft);
	}

	.error {
		background: #fdecec;
		border: 1px solid #f3c9c9;
		color: #8c2020;
		padding: 8px 10px;
		border-radius: 7px;
		font-size: 13px;
	}
</style>
