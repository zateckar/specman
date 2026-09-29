<script lang="ts">
	interface ChapterView {
		key: string;
		title: string;
		status: string;
		open_questions: string[];
		applicable?: boolean;
		skip_reason?: string;
		depth?: number;
		parent_key?: string;
	}

	let {
		chapters,
		activeKey,
		projectId,
		others = []
	}: {
		chapters: ChapterView[];
		activeKey: string | null;
		projectId: number;
		/** Colleagues with this same document open. */
		others?: Array<{ name: string; writing: boolean }>;
	} = $props();

	/**
	 * Two people describing the same chapter still end with one of their versions.
	 * Nothing here stops that — a design conversation is not a text editor, and
	 * locking a chapter would be worse than the problem it solves. Saying who else
	 * is here is what lets them avoid it themselves.
	 */
	const company = $derived.by(() => {
		if (others.length === 0) return '';

		const writing = others.filter((person) => person.writing).map((person) => person.name);
		if (writing.length === 1) return `${writing[0]} is writing in this document now`;
		if (writing.length > 1) return `${writing.length} people are writing in this document now`;

		const names = others.map((person) => person.name);
		if (names.length === 1) return `${names[0]} also has this document open`;
		if (names.length === 2) return `${names[0]} and ${names[1]} also have this document open`;
		return `${names.length} other people also have this document open`;
	});

	// Chapters the triage set aside do not count towards progress — a document
	// that reads "8 of 12" when four were never in scope understates itself.
	const inScope = $derived(chapters.filter((c) => c.applicable !== false));
	const setAside = $derived(chapters.filter((c) => c.applicable === false));

	// A chapter that has been split is a container: its content lives in its
	// sub-chapters, so counting both it and them counts the same work twice.
	// Derived here rather than taken from the server because the bar has to move
	// as statuses stream in. `countableChapters` in llm/subchapters.ts is the same
	// rule for the places that can read it — change one, change the other.
	const parents = $derived(new Set(chapters.map((c) => c.parent_key).filter(Boolean)));
	const counted = $derived(inScope.filter((c) => !parents.has(c.key)));

	const complete = $derived(counted.filter((c) => c.status === 'complete').length);
	const totalOpen = $derived(inScope.reduce((sum, c) => sum + c.open_questions.length, 0));
	const percent = $derived(counted.length ? Math.round((complete / counted.length) * 100) : 0);

	const statusLabel: Record<string, string> = {
		empty: 'Not started',
		in_progress: 'In progress',
		complete: 'Complete'
	};
</script>

<nav>
	<div class="progress">
		<div class="row">
			<strong>{percent}% complete</strong>
			<span>{complete} of {counted.length}</span>
		</div>
		<div class="meter"><div class="fill" style="width: {percent}%"></div></div>
		{#if totalOpen > 0}
			<p class="open-total">{totalOpen} question{totalOpen === 1 ? '' : 's'} still to answer</p>
		{:else if complete === chapters.length}
			<p class="done-total">Everything answered</p>
		{/if}
	</div>

	{#if company}
		<p class="company" class:writing={others.some((person) => person.writing)}>{company}</p>
	{/if}

	<ul>
		<li>
			<a class="item whole" class:active={activeKey === null} href="/projects/{projectId}">
				<span class="title">Whole document</span>
				<span class="hint">Overview and cross-checks</span>
			</a>
		</li>

		{#each inScope as chapter (chapter.key)}
			<li>
				<a
					class="item"
					class:active={activeKey === chapter.key}
					class:child={chapter.depth === 1}
					href="/projects/{projectId}?chapter={chapter.key}"
				>
					<span class="dot {chapter.status}" title={statusLabel[chapter.status]}></span>
					<span class="body">
						<span class="title">{chapter.title}</span>
						<span class="hint">
							{#if chapter.open_questions.length > 0}
								<span class="open"
									>{chapter.open_questions.length} open question{chapter.open_questions.length ===
									1
										? ''
										: 's'}</span
								>
							{:else}
								{statusLabel[chapter.status]}
							{/if}
						</span>
					</span>
				</a>
			</li>
		{/each}
	</ul>

	{#if setAside.length > 0}
		<div class="aside">
			<strong>Not needed for this application</strong>
			<ul>
				{#each setAside as chapter (chapter.key)}
					<li>
						<a href="/projects/{projectId}?chapter={chapter.key}" title={chapter.skip_reason}>
							{chapter.title}
						</a>
					</li>
				{/each}
			</ul>
			<p>Open one if you think it does apply.</p>
		</div>
	{/if}
</nav>

<style>
	.item.child {
		padding-left: 30px;
	}

	.item.child .title {
		font-size: 12.5px;
	}

	.aside {
		margin-top: 14px;
		padding: 12px 16px 14px;
		border-top: 1px solid var(--line);
	}

	.aside strong {
		display: block;
		font-size: 10.5px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--ink-soft);
		margin-bottom: 7px;
	}

	.aside ul {
		list-style: none;
		margin: 0 0 7px;
		padding: 0;
	}

	.aside li {
		margin-bottom: 3px;
	}

	.aside a {
		font-size: 12.5px;
		color: var(--ink-soft);
		text-decoration: none;
	}

	.aside a:hover {
		text-decoration: underline;
	}

	.aside p {
		font-size: 11.5px;
		color: var(--ink-soft);
		margin: 0;
	}

	nav {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: auto;
		background: var(--panel);
		border-right: 1px solid var(--line);
	}

	.progress {
		padding: 16px;
		border-bottom: 1px solid var(--line);
		position: sticky;
		top: 0;
		background: var(--panel);
	}

	.row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		font-size: 13px;
		color: var(--ink-soft);
		margin-bottom: 7px;
	}

	.row strong {
		color: var(--ink);
		font-size: 14px;
	}

	.meter {
		height: 5px;
		background: var(--line);
		border-radius: 3px;
		overflow: hidden;
	}

	.fill {
		height: 100%;
		background: var(--accent);
		transition: width 0.3s ease;
	}

	.open-total {
		margin: 9px 0 0;
		font-size: 12px;
		color: var(--warn);
	}

	.done-total {
		margin: 9px 0 0;
		font-size: 12px;
		color: var(--ok);
	}

	.company {
		margin: 0;
		padding: 9px 14px;
		font-size: 12px;
		line-height: 1.4;
		color: var(--ink-soft);
		background: var(--accent-soft);
		border-bottom: 1px solid var(--line);
	}

	.company.writing {
		background: var(--warn-soft);
		color: #6f4a0d;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 8px;
	}

	.item {
		display: flex;
		gap: 9px;
		align-items: flex-start;
		padding: 8px 10px;
		border-radius: 7px;
		text-decoration: none;
		color: inherit;
	}

	.item:hover {
		background: var(--bg);
	}

	.item.active {
		background: var(--accent-soft);
	}

	.item.active .title {
		color: var(--accent);
		font-weight: 600;
	}

	.whole {
		border-bottom: 1px solid var(--line);
		border-radius: 7px 7px 0 0;
		margin-bottom: 6px;
		padding-bottom: 12px;
		flex-direction: column;
		gap: 1px;
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		margin-top: 6px;
		flex: 0 0 auto;
		background: var(--line);
		border: 1px solid #c9d2cd;
	}

	.dot.in_progress {
		background: #e8b45a;
		border-color: #d29a37;
	}

	.dot.complete {
		background: var(--ok);
		border-color: var(--ok);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}

	.title {
		font-size: 14px;
	}

	.hint {
		font-size: 12px;
		color: var(--ink-soft);
	}

	.open {
		color: var(--warn);
	}
</style>
