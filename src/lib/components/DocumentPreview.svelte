<script lang="ts">
	import { renderMarkdown } from '$lib/safe-markdown';
	import { invalidateAll } from '$app/navigation';

	interface ChapterView {
		key: string;
		title: string;
		goal?: string;
		status: string;
		open_questions: string[];
		content_md: string;
		parent_key?: string;
		applicable?: boolean;
		skip_reason?: string;
	}

	interface RequirementView {
		ref: string;
		chapter_key: string;
		statement: string;
		scope: string;
		scenarios: Array<{ when: string; then: string }>;
	}

	interface FindingView {
		severity: 'error' | 'warning';
		message: string;
		chapterKey?: string;
		ref?: string;
	}

	interface DecisionView {
		id: number;
		chapter_key: string;
		statement: string;
		rationale: string;
		source: string;
		status: string;
	}

	let {
		projectName,
		chapters,
		requirements = [],
		decisions = [],
		findings = [],
		activeKey,
		pendingChanges,
		projectId,
		writingKey = null,
		draftingKeys = [],
		drafting = false
	}: {
		projectName: string;
		chapters: ChapterView[];
		requirements?: RequirementView[];
		decisions?: DecisionView[];
		findings?: FindingView[];
		activeKey: string | null;
		pendingChanges: boolean;
		projectId: number;
		/**
		 * The chapter the assistant is writing right now. Its text here is what has
		 * arrived so far and is not saved; a turn that fails puts the stored text back.
		 */
		writingKey?: string | null;
		/** Chapters the assistant's draft is writing now. Nothing of them is shown until saved. */
		draftingKeys?: string[];
		/**
		 * A draft is running. The review, the diagram and the mock-up wait for it: any would
		 * take half a document for the whole.
		 */
		drafting?: boolean;
	} = $props();

	// Decisions the assistant made on the user's behalf. Surfaced where they are
	// reading, because the whole point is that they can tell these apart from
	// choices they made themselves.
	function assumedIn(key: string): DecisionView[] {
		return decisions.filter(
			(d) => d.chapter_key === key && d.source !== 'user' && d.status !== 'confirmed'
		);
	}

	let decisionError = $state('');
	async function confirm(id: number) {
		decisionError = '';
		try {
			const response = await fetch('/api/decisions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ projectId, id, action: 'confirm' })
			});
			if (!response.ok) {
				const body = await response.json();
				throw new Error(body.message ?? 'Your choice could not be recorded.');
			}
			await invalidateAll();
		} catch (cause) {
			decisionError = cause instanceof Error ? cause.message : 'Your choice could not be recorded.';
		}
	}

	/** Every assumption in one chapter, for someone who has read it and agrees. */
	async function confirmAll(chapterKey: string) {
		decisionError = '';
		try {
			const response = await fetch('/api/decisions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ projectId, chapterKey, action: 'confirm-chapter' })
			});
			if (!response.ok) {
				const body = await response.json();
				throw new Error(body.message ?? 'Your choice could not be recorded.');
			}
			await invalidateAll();
		} catch (cause) {
			decisionError = cause instanceof Error ? cause.message : 'Your choice could not be recorded.';
		}
	}

	// "What must always be true" — the checkable half of a chapter. WHEN/THEN is
	// how it is stored; the user is shown "If … then …".
	const SCOPE_LABEL: Record<string, string> = {
		now: 'Must always be true',
		later: 'Agreed, but not in the first version',
		out: 'Deliberately not doing'
	};

	function requirementsFor(key: string, scope: string): RequirementView[] {
		return requirements.filter((r) => r.chapter_key === key && r.scope === scope);
	}

	const shownFindings = $derived(
		activeKey ? findings.filter((f) => f.chapterKey === activeKey) : findings
	);

	// Rendered through `safe-markdown`, never `marked` directly: chapter prose is
	// model output shaped by whatever the user typed, and it is rendered with
	// `{@html}` into every colleague's session.
	const render = renderMarkdown;

	// Selecting a chapter shows that chapter alone. The assembled document is what
	// "Whole document" is for — scrolling a twelve-chapter page to find the one
	// being discussed put the answer and the question on different screens.
	//
	// A chapter that has been split is the exception: it is shown with its sections
	// beneath it, because a container's content *is* its sections. Selecting one
	// section still shows that section alone.
	//
	// A chapter the triage set aside is left out of the whole document, as it is
	// left out of the progress and the handoff; listed there it read "not
	// started", as if it were still to be done. Opened on its own it says why.
	const shown = $derived(
		activeKey
			? chapters.filter((c) => c.key === activeKey || c.parent_key === activeKey)
			: chapters.filter((c) => c.applicable !== false)
	);

	// A container is not unwritten when it has nothing of its own left — that is
	// what being split means.
	const containers = $derived(new Set(chapters.map((c) => c.parent_key).filter(Boolean)));

	function sectionCount(key: string): number {
		return chapters.filter((c) => c.parent_key === key).length;
	}
</script>

<aside>
	{#if decisionError}<p class="decision-error" role="alert">{decisionError}</p>{/if}
	<header>
		<h2>{projectName}</h2>
		{#if !drafting}
			<a class="handoff" href="/projects/{projectId}/diagram">Diagram</a>
			<a class="handoff" href="/projects/{projectId}/mockup">Mock-up</a>
		{/if}
		<a class="handoff" href="/projects/{projectId}/export">For a developer</a>
		{#if drafting}
			<span class="clean">Review once the draft is finished</span>
		{:else if pendingChanges}
			<a class="review" href="/projects/{projectId}/review">Review changes</a>
		{:else}
			<span class="clean">No pending changes</span>
		{/if}
	</header>

	<div class="doc">
		{#if activeKey}
			<p class="scope">
				Showing one chapter — open <strong>Whole document</strong> for all of it.
			</p>
		{/if}

		{#if shownFindings.length > 0}
			<div class="findings">
				{#each shownFindings.slice(0, 6) as finding}
					<p class={finding.severity}>{finding.message}</p>
				{/each}
			</div>
		{/if}

		{#each shown as chapter (chapter.key)}
			<article
				data-chapter={chapter.key}
				class:active={chapter.key === activeKey}
				class:section={!!chapter.parent_key}
			>
				<h3>
					{chapter.title}
					{#if chapter.key === writingKey || draftingKeys.includes(chapter.key)}
						<span class="badge writing">being written…</span>
					{:else if chapter.applicable === false}
						<span class="badge">not needed</span>
					{:else}
						<span class="badge {chapter.status}">
							{chapter.status === 'complete'
								? 'complete'
								: chapter.status === 'in_progress'
									? 'in progress'
									: 'not started'}
						</span>
					{/if}
				</h3>

				{#if chapter.goal}
					<p class="goal">{chapter.goal}</p>
				{/if}

				{#if chapter.applicable === false && !chapter.content_md?.trim()}
					<p class="unwritten">
						Not needed for this application{chapter.skip_reason ? ` — ${chapter.skip_reason}` : ''}. If
						it does apply, include it from the list of chapters.
					</p>
				{:else if chapter.content_md?.trim()}
					<div class="body">{@html render(chapter.content_md)}</div>
				{:else if containers.has(chapter.key)}
					{@const count = sectionCount(chapter.key)}
					<p class="unwritten">
						Written as {count} part{count === 1 ? '' : 's'}{activeKey === chapter.key
							? ', below.'
							: '.'}
					</p>
				{:else}
					<p class="unwritten">Not written yet.</p>
				{/if}

				{#each ['now', 'later', 'out'] as scope}
					{@const group = requirementsFor(chapter.key, scope)}
					{#if group.length > 0}
						<div class="reqs {scope}">
							<strong class="reqs-label">{SCOPE_LABEL[scope]}</strong>
							<ul>
								{#each group as requirement (requirement.ref)}
									<li>
										<span class="statement">{requirement.statement}</span>
										{#each requirement.scenarios as scenario}
											<span class="scenario">
												If {scenario.when}, then {scenario.then}.
											</span>
										{/each}
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				{/each}

				{#each [assumedIn(chapter.key)] as assumed}
					{#if assumed.length > 0}
						<div class="assumed">
							<strong class="assumed-label">Decided for you — please check</strong>
							{#each assumed as decision (decision.id)}
								<div class="assumption">
									<div>
										<span class="statement">{decision.statement}</span>
										{#if decision.rationale}
											<span class="why">{decision.rationale}</span>
										{/if}
									</div>
									<button onclick={() => confirm(decision.id)}>That's right</button>
								</div>
							{/each}
							{#if assumed.length > 1}
								<div class="confirm-all">
									<button onclick={() => confirmAll(chapter.key)}>All of these are right</button>
								</div>
							{/if}
						</div>
					{/if}
				{/each}

				{#if chapter.open_questions.length > 0}
					<div class="open">
						<strong>Still to decide</strong>
						<ul>
							{#each chapter.open_questions as question}
								<li>{question}</li>
							{/each}
						</ul>
					</div>
				{/if}
			</article>
		{/each}
	</div>
</aside>

<style>
	aside {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-width: 0;
		background: var(--panel);
	}

	header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 20px;
		border-bottom: 1px solid var(--line);
		flex: 0 0 auto;
	}

	h2 {
		font-size: 15px;
		margin: 0;
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.review {
		font-size: 12.5px;
		background: var(--accent);
		color: #fff;
		text-decoration: none;
		padding: 5px 11px;
		border-radius: 14px;
		white-space: nowrap;
	}

	.clean {
		font-size: 12px;
		color: var(--ink-soft);
		white-space: nowrap;
	}

	.handoff {
		font-size: 12.5px;
		color: var(--ink-soft);
		text-decoration: none;
		white-space: nowrap;
		border: 1px solid var(--line);
		padding: 4px 10px;
		border-radius: 14px;
	}

	.handoff:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.doc {
		flex: 1;
		overflow-y: auto;
		padding: 20px 24px 60px;
	}

	.scope {
		font-size: 12px;
		color: var(--ink-soft);
		margin: 0 0 12px;
	}

	article {
		padding: 14px 16px;
		margin: 0 -16px 6px;
		border-radius: var(--radius);
		border: 1px solid transparent;
		scroll-margin-top: 12px;
	}

	article.active {
		border-color: var(--line);
		background: #fcfdfc;
	}

	/* Indented under its parent, so a container reads as one chapter in parts
	   rather than as several chapters that happen to follow each other. */
	article.section {
		margin-left: 0;
		padding-left: 28px;
		border-left: 2px solid var(--line);
		border-radius: 0;
	}

	article.section h3 {
		font-size: 14px;
	}

	h3 {
		font-size: 15px;
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
	}

	.badge {
		font-size: 10.5px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 2px 7px;
		border-radius: 10px;
		background: var(--line);
		color: var(--ink-soft);
	}

	.badge.in_progress {
		background: var(--warn-soft);
		color: var(--warn);
	}

	.badge.complete {
		background: var(--accent-soft);
		color: var(--ok);
	}

	.badge.writing {
		background: var(--accent);
		color: #fff;
	}

	.body {
		font-size: 14px;
		color: #26332d;
	}

	.body :global(h1),
	.body :global(h2) {
		font-size: 15px;
		margin: 14px 0 6px;
	}

	.body :global(h3),
	.body :global(h4) {
		font-size: 14px;
		margin: 12px 0 4px;
	}

	.body :global(p) {
		margin: 0 0 9px;
	}

	.body :global(ul),
	.body :global(ol) {
		margin: 0 0 9px;
		padding-left: 20px;
	}

	.body :global(li) {
		margin-bottom: 3px;
	}

	.body :global(code) {
		font-family: var(--mono);
		font-size: 12.5px;
		background: var(--bg);
		padding: 1px 4px;
		border-radius: 4px;
	}

	.body :global(table) {
		border-collapse: collapse;
		font-size: 13px;
		margin-bottom: 10px;
	}

	.body :global(th),
	.body :global(td) {
		border: 1px solid var(--line);
		padding: 5px 9px;
		text-align: left;
	}

	.unwritten {
		color: var(--ink-soft);
		font-size: 13.5px;
		font-style: italic;
		margin: 0;
	}

	.decision-error {
		margin: 10px 16px 0;
		background: #fdecec;
		border: 1px solid #f3c9c9;
		color: #8c2020;
		padding: 8px 10px;
		border-radius: 7px;
		font-size: 13px;
	}

	.goal {
		font-size: 13px;
		color: var(--ink-soft);
		margin: 0 0 10px;
	}

	.findings {
		margin-bottom: 14px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.findings p {
		margin: 0;
		font-size: 12.5px;
		padding: 6px 10px;
		border-radius: 6px;
	}

	.findings .error {
		background: #fdecec;
		border: 1px solid #f3c9c9;
		color: #8c2020;
	}

	.findings .warning {
		background: var(--warn-soft);
		border: 1px solid #eddcb8;
		color: #6f4a0d;
	}

	.assumed {
		margin-top: 12px;
		background: #f4f1fb;
		border: 1px solid #ddd4f0;
		border-radius: 8px;
		padding: 9px 12px;
	}

	.assumed-label {
		display: block;
		font-size: 11.5px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #5b46a0;
		margin-bottom: 6px;
	}

	.assumption {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 5px 0;
	}

	.assumption > div {
		flex: 1;
	}

	.assumption .statement {
		display: block;
		font-size: 13px;
	}

	.assumption .why {
		display: block;
		font-size: 12px;
		color: var(--ink-soft);
		margin-top: 2px;
	}

	.assumption button {
		flex: 0 0 auto;
		font-size: 12px;
		padding: 4px 10px;
		border-radius: 12px;
		border: 1px solid #ddd4f0;
		background: #fff;
		color: #5b46a0;
		white-space: nowrap;
	}

	.confirm-all {
		display: flex;
		justify-content: flex-end;
		border-top: 1px solid #ddd4f0;
		margin-top: 4px;
		padding-top: 7px;
	}

	.confirm-all button {
		font-size: 12px;
		padding: 4px 12px;
		border-radius: 12px;
		border: 1px solid #5b46a0;
		background: #5b46a0;
		color: #fff;
		white-space: nowrap;
	}

	.reqs {
		margin-top: 12px;
		border-left: 3px solid var(--accent);
		padding-left: 12px;
	}

	.reqs.later {
		border-left-color: var(--warn);
	}

	.reqs.out {
		border-left-color: var(--line);
		opacity: 0.75;
	}

	.reqs-label {
		display: block;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--ink-soft);
		margin-bottom: 6px;
	}

	.reqs ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.reqs li {
		margin-bottom: 8px;
	}

	.statement {
		display: block;
		font-size: 13.5px;
	}

	.scenario {
		display: block;
		font-size: 12.5px;
		color: var(--ink-soft);
		margin-top: 2px;
	}

	.open {
		margin-top: 10px;
		background: var(--warn-soft);
		border: 1px solid #eddcb8;
		border-radius: 8px;
		padding: 9px 12px;
		font-size: 13px;
	}

	.open strong {
		display: block;
		color: var(--warn);
		font-size: 11.5px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-bottom: 5px;
	}

	.open ul {
		margin: 0;
		padding-left: 18px;
	}

	.open li {
		margin-bottom: 3px;
	}
</style>
