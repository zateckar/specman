<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	let openKey = $state<string | null>(null);
</script>

<main>
	<a class="back" href="/">← Back to applications</a>
	<h1>Document template</h1>
	<p class="sub">
		These chapters are used for every new application. The questions are what the assistant works
		through with the user; the criteria decide when a chapter counts as complete.
		<strong>Editing a template does not change documents already in progress</strong> — each
		application keeps the questions it started with.
	</p>

	{#if data.templates.length > 1}
		<nav class="tabs">
			{#each data.templates as template}
				<a
					class="tab"
					class:active={template.id === data.selected.id}
					href="?template={template.id}">{template.name}</a
				>
			{/each}
		</nav>
	{/if}

	<ul class="chapters">
		{#each data.chapters as chapter (chapter.id)}
			<li class="card">
				<button
					class="row"
					onclick={() => (openKey = openKey === chapter.key ? null : chapter.key)}
					aria-expanded={openKey === chapter.key}
				>
					<span class="name">{chapter.title}</span>
					<span class="meta">
						{chapter.questions.length} question{chapter.questions.length === 1 ? '' : 's'} ·
						{chapter.criteria.length} criteri{chapter.criteria.length === 1 ? 'on' : 'a'}
						{#if chapter.is_dynamic}<span class="pill">expandable</span>{/if}
					</span>
					<span class="chev">{openKey === chapter.key ? '−' : '+'}</span>
				</button>

				{#if openKey === chapter.key}
					<form method="POST" action="?/save" use:enhance class="editor">
						<input type="hidden" name="id" value={chapter.id} />

						<label>
							Title
							<input name="title" value={chapter.title} />
						</label>

						<label>
							Goal — one sentence, shown to the user above the chapter
							<input name="goal" value={chapter.goal ?? ''} />
						</label>

						<label>
							Purpose — guidance for the assistant, not shown to the user
							<textarea name="purpose" rows="3">{chapter.purpose}</textarea>
						</label>

						<label>
							Questions — one per line, in the order they should be asked
							<textarea name="questions" rows="5">{chapter.questions.join('\n')}</textarea>
						</label>

						<label>
							Complete when — one condition per line
							<textarea name="criteria" rows="5">{chapter.criteria.join('\n')}</textarea>
						</label>

						<div class="actions">
							<button type="submit" class="primary">Save chapter</button>
							{#if form?.saved === chapter.id}<span class="saved">Saved</span>{/if}
							{#if form?.failed === chapter.id && form?.message}<span class="failed" role="alert">{form.message}</span>{/if}
						</div>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
</main>

<style>
	main {
		flex: 1;
		overflow: auto;
		padding: 24px 28px 60px;
		max-width: 820px;
		width: 100%;
		margin: 0 auto;
	}

	.back {
		font-size: 13px;
		text-decoration: none;
	}

	h1 {
		font-size: 21px;
		margin: 10px 0 8px;
	}

	.sub {
		color: var(--ink-soft);
		font-size: 13.5px;
		margin: 0 0 18px;
	}

	.tabs {
		display: flex;
		gap: 6px;
		margin-bottom: 14px;
	}

	.tab {
		font-size: 13px;
		padding: 6px 12px;
		border-radius: 14px;
		text-decoration: none;
		background: var(--panel);
		border: 1px solid var(--line);
	}

	.tab.active {
		background: var(--accent-soft);
		border-color: var(--accent);
	}

	.chapters {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.card {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		overflow: hidden;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 13px 16px;
		background: none;
		border: 0;
		text-align: left;
	}

	.row:hover {
		background: var(--bg);
	}

	.name {
		font-weight: 600;
		font-size: 14.5px;
	}

	.meta {
		flex: 1;
		font-size: 12.5px;
		color: var(--ink-soft);
	}

	.pill {
		background: var(--accent-soft);
		color: var(--accent);
		border-radius: 9px;
		padding: 1px 7px;
		font-size: 11px;
		margin-left: 6px;
	}

	.chev {
		color: var(--ink-soft);
		font-size: 16px;
	}

	.editor {
		padding: 4px 16px 16px;
		border-top: 1px solid var(--line);
	}

	label {
		display: block;
		font-size: 12.5px;
		color: var(--ink-soft);
		margin: 12px 0 0;
	}

	input,
	textarea {
		display: block;
		width: 100%;
		margin-top: 4px;
		padding: 8px 10px;
		font: inherit;
		font-size: 13.5px;
		border: 1px solid var(--line);
		border-radius: 7px;
		resize: vertical;
	}

	input:focus,
	textarea:focus {
		outline: 2px solid var(--accent);
		outline-offset: -1px;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 14px;
	}

	.primary {
		background: var(--accent);
		color: #fff;
		border: 0;
		border-radius: 7px;
		padding: 8px 14px;
		font-weight: 600;
	}

	.saved {
		font-size: 12.5px;
		color: var(--ok);
	}

	.failed {
		font-size: 12.5px;
		color: #8c2020;
	}
</style>
