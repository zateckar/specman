<script lang="ts">
	let { data } = $props();

	interface Line {
		text: string;
		kind: 'add' | 'del' | 'meta' | 'ctx';
	}

	// Show prose diffs, not machine noise: drop index/hash lines entirely.
	const lines: Line[] = $derived(
		data.diff
		.split('\n')
		.filter((l) => !/^(index |new file mode|deleted file mode|similarity |rename )/.test(l))
		.map((text) => {
			if (text.startsWith('+++') || text.startsWith('---') || text.startsWith('diff --git'))
				return { text, kind: 'meta' as const };
			if (text.startsWith('@@')) return { text, kind: 'meta' as const };
			if (text.startsWith('+')) return { text: text.slice(1), kind: 'add' as const };
			if (text.startsWith('-')) return { text: text.slice(1), kind: 'del' as const };
			return { text: text.replace(/^ /, ''), kind: 'ctx' as const };
		})
	);

	const added = $derived(lines.filter((l) => l.kind === 'add').length);
	const removed = $derived(lines.filter((l) => l.kind === 'del').length);

	let showDiff = $state(false);

	const KIND_LABEL: Record<string, string> = {
		added: 'New',
		changed: 'Changed',
		removed: 'Removed'
	};

	// "Changed" is vague when the only thing that moved was the timing.
	function describeChange(change: { fields: string[] }): string {
		const named: Record<string, string> = {
			statement: 'wording',
			scope: 'when it will be built',
			scenarios: 'the example'
		};
		return change.fields.map((f) => named[f] ?? f).join(' and ');
	}

	// The check costs several gateway calls, so it runs on request and its result
	// is kept — re-reading a report should not cost what producing it cost.
	let checking = $state(false);
	let checkError = $state('');
	interface IssueView {
		kind: string;
		chapters: string[];
		refs: string[];
		message: string;
	}

	let issues = $state<IssueView[]>((data.verification?.issues ?? []) as IssueView[]);
	let checkedAt = $state<string | null>(data.verification?.created_at ?? null);

	const ISSUE_LABEL: Record<string, string> = {
		contradiction: 'These disagree',
		missing: 'Never written down',
		drift: 'No longer matches',
		unclear: 'Too vague to build'
	};

	async function check() {
		checking = true;
		checkError = '';
		try {
			const response = await fetch('/api/verify', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ projectId: data.project.id })
			});
			if (!response.ok) throw new Error(`Check failed (${response.status})`);

			const result = await response.json();
			issues = result.issues;
			checkedAt = result.created_at;
		} catch (cause) {
			checkError = cause instanceof Error ? cause.message : 'The check could not be run.';
		} finally {
			checking = false;
		}
	}

	async function decide(id: number, action: 'confirm' | 'discard') {
		await fetch('/api/decisions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ projectId: data.project.id, id, action })
		});
		location.reload();
	}
</script>

<main>
	<a class="back" href="/projects/{data.project.id}">← Back to {data.project.name}</a>

	<h1>Review changes</h1>

	{#if !data.proposal || lines.length === 0}
		<div class="card empty">
			<p><strong>Nothing to review.</strong></p>
			<p class="sub">
				Everything the assistant has written so far is already part of the approved document.
			</p>
		</div>
	{:else}
		<div class="card summary">
			<div>
				<strong>{data.proposal.title || 'Design updates'}</strong>
				<p class="sub">
					{data.changeSummary} · branch <code>{data.proposal.branch}</code>
				</p>
			</div>
			<form method="POST" action="?/approve">
				<button type="submit" class="primary">Approve and merge</button>
			</form>
		</div>

		{#if data.pendingDecisions.length > 0}
			<div class="card pending">
				<h2>Decided for you</h2>
				<p class="sub">
					The assistant chose these because the answer was left to it. Confirm each one, or say
					it is wrong and it will be raised with you again.
				</p>
				{#each data.pendingDecisions as decision}
					<div class="decision">
						<div>
							<strong>{decision.statement}</strong>
							{#if decision.rationale}<p class="why">{decision.rationale}</p>{/if}
							<p class="where">{data.chapterTitles[decision.chapter_key] ?? decision.chapter_key}</p>
						</div>
						<div class="actions">
							<button onclick={() => decide(decision.id, 'confirm')}>That's right</button>
							<button class="ghost" onclick={() => decide(decision.id, 'discard')}>
								Not right
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		<div class="card check">
			<div class="check-head">
				<div>
					<h2>Does it all hold together?</h2>
					<p class="sub">
						{#if checkedAt}
							Last checked {new Date(checkedAt).toLocaleString()} · {issues.length === 0
								? 'nothing flagged'
								: `${issues.length} thing${issues.length === 1 ? '' : 's'} flagged`}
						{:else}
							Reads every chapter together, looking for parts that disagree, decisions never
							written down, and anything too vague to build from.
						{/if}
					</p>
				</div>
				<button onclick={check} disabled={checking}>
					{checking ? 'Checking…' : checkedAt ? 'Check again' : 'Check the document'}
				</button>
			</div>

			{#if checkError}
				<p class="check-error">{checkError}</p>
			{/if}

			{#each issues as issue}
				<div class="issue">
					<span class="tag {issue.kind}">{ISSUE_LABEL[issue.kind] ?? issue.kind}</span>
					<div class="text">
						<strong>{issue.message}</strong>
						{#if issue.chapters.length > 0 || issue.refs.length > 0}
							<p class="where">
								{issue.chapters.map((k) => data.chapterTitles[k] ?? k).join(', ')}
								{#if issue.refs.length > 0} · {issue.refs.join(', ')}{/if}
							</p>
						{/if}
					</div>
				</div>
			{/each}
		</div>

		{#if data.changes.length > 0}
			<div class="card changes">
				<h2>What must be true</h2>
				{#each data.changes as change}
					<div class="change {change.kind}">
						<span class="tag {change.kind}">{KIND_LABEL[change.kind]}</span>
						<div class="text">
							<strong>{(change.after ?? change.before)?.statement}</strong>
							<p class="where">
								{data.chapterTitles[change.chapter] ?? change.chapter} · {change.ref}
								{#if change.kind === 'changed'} · {describeChange(change)} changed{/if}
							</p>
							{#if change.kind === 'changed' && change.before && change.before.statement !== change.after?.statement}
								<p class="was">Was: {change.before.statement}</p>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}

		<button class="toggle" onclick={() => (showDiff = !showDiff)}>
			{showDiff ? 'Hide' : 'Show'} the text of every change ({added} added, {removed} removed)
		</button>

		{#if showDiff}
			<div class="card diff">
				{#each lines as line}
					<div class="line {line.kind}">{line.text || ' '}</div>
				{/each}
			</div>
		{/if}
	{/if}

	{#if data.history.length > 0}
		<h2>History</h2>
		<ul class="history card">
			{#each data.history as entry}
				<li>
					<code>{entry.hash}</code>
					<span>{entry.message}</span>
					<time>{new Date(entry.date).toLocaleString()}</time>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	main {
		flex: 1;
		overflow: auto;
		padding: 24px 28px 60px;
		max-width: 900px;
		width: 100%;
		margin: 0 auto;
	}

	.back {
		font-size: 13px;
		text-decoration: none;
	}

	h1 {
		font-size: 21px;
		margin: 10px 0 16px;
	}

	h2 {
		font-size: 15px;
		margin: 26px 0 10px;
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

	.pending,
	.changes,
	.check {
		margin-bottom: 14px;
	}

	.pending h2,
	.changes h2,
	.check h2 {
		margin-top: 0;
	}

	.check-head {
		display: flex;
		align-items: flex-start;
		gap: 16px;
	}

	.check-head > div {
		flex: 1;
	}

	.check-head button {
		flex: 0 0 auto;
		font-size: 12.5px;
		padding: 7px 14px;
		border-radius: 7px;
		border: 1px solid var(--accent);
		background: transparent;
		color: var(--accent);
		white-space: nowrap;
	}

	.check-head button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.check-error {
		background: #fdecec;
		border: 1px solid #f3c9c9;
		color: #8c2020;
		padding: 8px 10px;
		border-radius: 7px;
		font-size: 13px;
		margin: 10px 0 0;
	}

	.issue {
		display: flex;
		gap: 12px;
		padding: 10px 0;
		border-top: 1px solid var(--line);
		margin-top: 10px;
	}

	.issue:not(:first-of-type) {
		margin-top: 0;
	}

	.issue .text {
		flex: 1;
	}

	.issue strong {
		font-size: 13.5px;
		font-weight: 500;
	}

	.tag.contradiction {
		background: #fdecec;
		color: #8c2020;
	}

	.tag.missing {
		background: var(--warn-soft);
		color: var(--warn);
	}

	.tag.drift,
	.tag.unclear {
		background: var(--line);
		color: var(--ink-soft);
	}

	.decision {
		display: flex;
		gap: 16px;
		align-items: flex-start;
		padding: 12px 0;
		border-top: 1px solid var(--line);
	}

	.decision > div:first-child {
		flex: 1;
	}

	.decision .actions {
		display: flex;
		gap: 6px;
		flex: 0 0 auto;
	}

	.decision button {
		font-size: 12.5px;
		padding: 6px 12px;
		border-radius: 7px;
		border: 1px solid var(--accent);
		background: var(--accent);
		color: #fff;
		white-space: nowrap;
	}

	.decision button.ghost {
		background: transparent;
		color: var(--ink-soft);
		border-color: var(--line);
	}

	.why {
		font-size: 13px;
		color: var(--ink-soft);
		margin: 4px 0 0;
	}

	.where {
		font-size: 12px;
		color: var(--ink-soft);
		margin: 4px 0 0;
	}

	.was {
		font-size: 12.5px;
		color: var(--ink-soft);
		margin: 4px 0 0;
		text-decoration: line-through;
	}

	.change {
		display: flex;
		gap: 12px;
		padding: 10px 0;
		border-top: 1px solid var(--line);
	}

	.change .text {
		flex: 1;
	}

	.change strong {
		font-size: 13.5px;
		font-weight: 500;
	}

	.tag {
		flex: 0 0 auto;
		font-size: 10.5px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 3px 8px;
		border-radius: 10px;
		height: fit-content;
		background: var(--line);
		color: var(--ink-soft);
	}

	.tag.added {
		background: var(--accent-soft);
		color: var(--ok);
	}

	.tag.changed {
		background: var(--warn-soft);
		color: var(--warn);
	}

	.tag.removed {
		background: #fdecec;
		color: #8c2020;
	}

	.change.removed strong {
		text-decoration: line-through;
		color: var(--ink-soft);
	}

	.toggle {
		background: none;
		border: 0;
		color: var(--ink-soft);
		font-size: 13px;
		padding: 4px 0;
		margin-bottom: 10px;
		text-decoration: underline;
	}

	.sub {
		color: var(--ink-soft);
		font-size: 13px;
		margin: 3px 0 0;
	}

	.primary {
		background: var(--accent);
		color: #fff;
		border: 0;
		border-radius: 7px;
		padding: 9px 15px;
		font-weight: 600;
		white-space: nowrap;
	}

	.diff {
		padding: 12px 0;
		font-family: var(--mono);
		font-size: 12.5px;
		overflow-x: auto;
	}

	.line {
		padding: 1px 16px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.line.add {
		background: #e8f6ec;
		border-left: 3px solid var(--ok);
	}

	.line.del {
		background: #fdecec;
		border-left: 3px solid #c05252;
		color: #7d3030;
	}

	.line.meta {
		color: var(--ink-soft);
		background: var(--bg);
		font-size: 11.5px;
		padding-top: 4px;
		padding-bottom: 4px;
	}

	.line.ctx {
		color: #46534c;
		border-left: 3px solid transparent;
	}

	.empty {
		text-align: center;
		padding: 34px;
	}

	.history {
		list-style: none;
		margin: 0;
		padding: 8px 16px;
	}

	.history li {
		display: flex;
		gap: 10px;
		align-items: baseline;
		padding: 6px 0;
		border-bottom: 1px solid var(--line);
		font-size: 13px;
	}

	.history li:last-child {
		border-bottom: 0;
	}

	.history code {
		font-family: var(--mono);
		font-size: 12px;
		color: var(--ink-soft);
	}

	.history span {
		flex: 1;
	}

	.history time {
		color: var(--ink-soft);
		font-size: 12px;
		white-space: nowrap;
	}

	code {
		font-family: var(--mono);
	}
</style>
