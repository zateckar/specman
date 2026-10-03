<script lang="ts">
	let { data } = $props();

	// Polled while an overview is being made; reset by any navigation that reloads.
	let view = $derived(data.view);
	let busy = $state(false);
	let errorMessage = $state('');
	/** It was being made, and stopped with nothing new and no reason: the server restarted. */
	let interrupted = $state(false);

	const report = $derived(view.made?.report ?? null);
	const kilobytes = $derived(Math.max(1, Math.round(view.written / 1024)));

	const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
	const euros = (amount: number) => money.format(amount);
	const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

	async function stop() {
		try {
			const response = await fetch(`/api/overview?project=${data.project.id}`, { method: 'DELETE' });
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
			const response = await fetch('/api/overview', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ projectId: data.project.id })
			});
			const result = await response.json().catch(() => null);
			if (!response.ok) {
				errorMessage = result?.message ?? 'The overview could not be started just now. Try again in a minute.';
				return;
			}
			view = result;
		} catch {
			errorMessage = 'The overview could not be started just now. Try again in a minute.';
		} finally {
			busy = false;
		}
	}

	// One request at a time, a few seconds apart, for as long as one is being made.
	$effect(() => {
		if (!view.running) return;
		const timer = setTimeout(async () => {
			try {
				const response = await fetch(`/api/overview?project=${data.project.id}`);
				if (!response.ok) throw new Error(String(response.status));
				const next = await response.json();
				interrupted = !next.running && !next.problem && next.made?.createdAt === view.made?.createdAt;
				view = next;
			} catch {
				// The next look will tell; a missed one changes nothing.
				view = { ...view };
			}
		}, 3000);
		return () => clearTimeout(timer);
	});
</script>

<svelte:head><title>Overview — {data.project.name} — Specman</title></svelte:head>

{#snippet blocks(list: Array<{ kind: 'paragraph'; text: string } | { kind: 'list'; items: string[] }>)}
	{#each list as block}
		{#if block.kind === 'paragraph'}
			<p>{block.text}</p>
		{:else}
			<ul>
				{#each block.items as item}<li>{item}</li>{/each}
			</ul>
		{/if}
	{/each}
{/snippet}

{#snippet route(title: string, summary: string, r: NonNullable<typeof report>['byHand'], rate: number)}
	<div class="card">
		<h3>{title}</h3>
		<p class="muted">{summary}</p>
		<p class="big">{euros(r.cost)}</p>
		<p class="muted">{euros(r.costLow)} – {euros(r.costHigh)}</p>
		<p>
			{plural(r.days, 'person-day', 'person-days')} ({r.daysLow}–{r.daysHigh}) · about
			{plural(r.weeks, 'week', 'weeks')} with {plural(r.people, 'person', 'people')}
		</p>
		<table>
			<thead><tr><th>Work</th><th class="n">Person-days</th><th class="n">Cost</th></tr></thead>
			<tbody>
				{#each r.rows as row}
					<tr><td>{row.label}</td><td class="n">{row.days}</td><td class="n">{euros(row.days * rate)}</td></tr>
				{/each}
				{#if r.usage > 0}
					<tr><td>AI assistant usage</td><td class="n"></td><td class="n">{euros(r.usage)}</td></tr>
				{/if}
			</tbody>
		</table>
	</div>
{/snippet}

<main>
	<a class="back" href="/projects/{data.project.id}">← Back to {data.project.name}</a>

	<div class="head">
		<div>
			<h1>
				Business and technical overview
				{#if view.made?.stale}<span class="stale-badge">Out of date</span>{/if}
			</h1>
			<p class="sub">
				What {data.project.name} is, why it is worth doing, how complex it is, and what it would take
				to build and to run, written by the assistant from the document. The assistant makes the
				judgements; Specman calculates every figure from them, and says how underneath.
			</p>
		</div>
		{#if view.running}
			<button class="secondary" onclick={stop}>Stop</button>
		{:else}
			<button class="primary" onclick={make} disabled={busy || data.drafting || !data.canMake}>
				{view.made ? 'Refresh' : 'Make the overview'}
			</button>
		{/if}
	</div>

	<div class="status" role="status">
		{#if view.running}
			<p class="progress">
				{#if view.retrying}The first attempt could not be used, so the assistant is trying once more.{/if}
				{view.phase === 'writing'
					? `Writing the overview — ${kilobytes} KB so far…`
					: view.phase === 'waiting'
						? 'Waiting for the assistant, which is busy with other long work…'
						: 'The assistant is reading the document and weighing it…'}
				This takes a few minutes; you can leave this page and come back.
			</p>
		{:else if interrupted}
			<p class="note">It stopped before it was finished, perhaps because the server restarted. Make it again.</p>
		{/if}
	</div>

	{#if data.drafting}
		<p class="note">The assistant is still drafting this document. Make the overview once it has finished.</p>
	{:else if !data.canMake}
		<p class="note">The assistant is not available here, so it cannot make an overview.</p>
	{/if}

	{#if errorMessage || view.problem}
		<p class="error" role="alert">{errorMessage || view.problem}</p>
	{/if}

	{#if view.made && report}
		{#if view.made.stale}
			<div class="note stale">
				<span>The document has changed since this overview was made, so parts of it may be out of date.</span>
				{#if !view.running}
					<button class="link" onclick={make} disabled={busy || data.drafting || !data.canMake}>Refresh it</button>
				{/if}
			</div>
		{/if}

		<div class="toolbar">
			{#if view.made.createdAt}
				<span class="muted">Made {new Date(view.made.createdAt).toLocaleString()}</span>
			{/if}
			<span class="spacer"></span>
			<a href="/projects/{data.project.id}/overview/download" download>
				Save as a report — one HTML file to pass on or print
			</a>
		</div>

		<article class="report">
			<section>
				<h2>In short</h2>
				<div class="pitch">{@render blocks(report.pitch)}</div>
			</section>

			<section>
				<h2>Business case</h2>
				{@render blocks(report.businessCase)}
			</section>

			<section>
				<h2>How complex it is</h2>
				<div class="pair">
					<div class="card">
						<h3>For the business</h3>
						<span class="level {report.business.level}">{report.business.label}</span>
						{@render blocks(report.business.reasons)}
					</div>
					<div class="card">
						<h3>Technically</h3>
						<span class="level {report.technical.level}">{report.technical.label}</span>
						{@render blocks(report.technical.reasons)}
					</div>
				</div>
			</section>

			<section>
				<h2>Building it</h2>
				<div class="pair">
					{@render route('By people', 'A professional team writes the code by hand.', report.byHand, report.dayRate)}
					{@render route(
						'With an AI coding assistant',
						'The AI writes the code; people direct it, review it and accept it.',
						report.withAi,
						report.dayRate
					)}
				</div>
				<details>
					<summary>What the building consists of</summary>
					<table>
						<thead><tr><th>Part</th><th colspan="2" class="n">Share of the work</th></tr></thead>
						<tbody>
							{#each report.work as part}
								<tr>
									<td>{part.label}</td>
									<td class="share"><span class="bar" style:width="{part.percent}%"></span></td>
									<td class="n">{part.percent === 0 ? 'under 1%' : `${part.percent}%`}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</details>
			</section>

			<section>
				<h2>Running it on Azure</h2>
				<p class="muted">The company's reference architecture for an internal web application, sized for this one.</p>
				<table>
					<thead><tr><th>Service</th><th>Size</th><th class="n">Per month</th></tr></thead>
					<tbody>
						{#each report.running.services as service}
							<tr>
								<td><strong>{service.name}</strong><br /><span class="muted">{service.why || service.role}</span></td>
								<td>{service.sku}</td>
								<td class="n">{euros(service.monthly)}</td>
							</tr>
						{/each}
					</tbody>
					<tfoot><tr><td colspan="2">Production</td><td class="n">{euros(report.running.production)}</td></tr></tfoot>
				</table>
				{#if report.unpriced.length > 0}
					<p class="muted">
						Also named by the assistant, but not in the price list and not counted: {report.unpriced.join(', ')}.
					</p>
				{/if}
				<div class="totals">
					<div>
						Azure, every environment<strong>{euros(report.running.monthly)} a month</strong>
						<span class="muted">
							{euros(report.running.yearly)} a year, of which development and test
							{euros(report.running.nonProduction)} a month
						</span>
					</div>
					<div>
						Support and small changes<strong>{euros(report.running.support)} a year</strong>
						<span class="muted">people's time</span>
					</div>
					<div>
						Running it, in all<strong>{euros(report.running.yearly + report.running.support)} a year</strong>
						<span class="muted">Azure and support</span>
					</div>
				</div>
			</section>

			<section>
				<h2>What this rests on</h2>
				{#if report.assumptions.length > 0}
					<h3>The assistant assumed</h3>
					{@render blocks(report.assumptions)}
				{/if}
				<h3>How the figures are calculated</h3>
				<ul>
					{#each [...report.settled, ...report.basis] as line}<li>{line}</li>{/each}
				</ul>
			</section>
		</article>
	{:else if !view.running}
		<div class="empty">
			<p>No overview yet.</p>
			<p class="sub">
				It is made from the chapters written so far, so there needs to be something written down
				first. Making one takes a few minutes.
			</p>
		</div>
	{/if}
</main>

<style>
	main {
		padding: 24px;
		max-width: 1100px;
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

	.stale-badge {
		display: inline-block;
		vertical-align: middle;
		margin-left: 8px;
		background: var(--warn-soft);
		border: 1px solid #eddcb8;
		color: #6f4a0d;
		border-radius: 999px;
		padding: 1px 10px;
		font-size: 12px;
		font-weight: 600;
	}

	.sub {
		font-size: 13px;
		color: var(--ink-soft);
		margin: 0;
		max-width: 660px;
	}

	.muted {
		color: var(--ink-soft);
		font-size: 13px;
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
		font-weight: 600;
		white-space: nowrap;
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

	.note.stale {
		display: flex;
		align-items: center;
		gap: 12px;
		justify-content: space-between;
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 16px;
		margin-bottom: 10px;
		font-size: 13px;
	}

	.spacer {
		flex: 1;
	}

	.report {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 8px 28px 28px;
	}

	h2 {
		font-size: 17px;
		color: var(--accent);
		margin: 26px 0 10px;
	}

	h3 {
		font-size: 15px;
		margin: 14px 0 4px;
	}

	.card h3 {
		margin-top: 0;
	}

	section p,
	section ul {
		font-size: 14px;
		margin: 0 0 8px;
	}

	.pitch {
		border-left: 4px solid var(--accent);
		padding: 2px 0 2px 16px;
	}

	.pitch p {
		font-size: 17px;
		line-height: 1.5;
	}

	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}

	.card {
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 14px 16px;
	}

	.level {
		display: inline-block;
		border-radius: 999px;
		padding: 1px 12px;
		font-weight: 600;
		font-size: 13px;
		margin: 2px 0 8px;
	}

	.level.low {
		background: #e3f1e8;
		color: #1d5b36;
	}

	.level.medium {
		background: #fbf0d9;
		color: #7a5410;
	}

	.level.high {
		background: #f9e1df;
		color: #8a2a20;
	}

	.big {
		font-size: 26px !important;
		font-weight: 700;
		color: var(--accent);
		margin: 6px 0 0 !important;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
		margin-top: 8px;
	}

	th,
	td {
		text-align: left;
		padding: 5px 8px;
		border-bottom: 1px solid var(--line);
		vertical-align: top;
	}

	th {
		font-size: 11px;
		color: var(--ink-soft);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.n {
		text-align: right;
		white-space: nowrap;
	}

	tfoot td {
		font-weight: 700;
		border-top: 2px solid var(--ink);
		border-bottom: 0;
	}

	.share {
		width: 30%;
		vertical-align: middle;
	}

	.bar {
		display: block;
		height: 8px;
		min-width: 2px;
		border-radius: 4px;
		background: var(--accent);
	}

	details {
		margin-top: 12px;
		font-size: 13px;
	}

	summary {
		cursor: pointer;
		color: var(--accent);
	}

	.totals {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
		margin-top: 14px;
		font-size: 13px;
	}

	.totals div {
		background: var(--accent-soft);
		border-radius: var(--radius);
		padding: 10px 14px;
	}

	.totals strong {
		display: block;
		font-size: 18px;
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

	@media (max-width: 760px) {
		.pair,
		.totals {
			grid-template-columns: 1fr;
		}

		.report {
			padding: 4px 16px 20px;
		}
	}
</style>
