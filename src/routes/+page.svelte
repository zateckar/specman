<script lang="ts">
	let { data, form } = $props();
	let creating = $state(false);
</script>

<main>
	<div class="head">
		<div>
			<h1>Your applications</h1>
			<p class="sub">
				Each application gets a design document. Answer the assistant's questions and it writes
				the document for you.
			</p>
		</div>
		<button class="primary" onclick={() => (creating = !creating)}>
			{creating ? 'Cancel' : 'New application'}
		</button>
	</div>

	{#if creating}
		<form method="POST" action="?/create" class="card new">
			{#if form?.message}<p class="error">{form.message}</p>{/if}
			<label>
				What is it called?
				<input name="name" placeholder="Company car booking" required />
			</label>
			<label>
				What should it do? (one sentence — you can change this later)
				<input name="description" placeholder="Let employees book a pool car for a day" />
			</label>

			<p class="triage-intro">
				Four quick answers so we only ask you about the things that matter for this
				application. You can change any of them later.
			</p>

			<label>
				Does it already exist?
				<select name="kind">
					<option value="new">No — this is something new</option>
					<option value="change">Yes — we want to change something we already have</option>
				</select>
			</label>

			<label>
				Who can get to it?
				<select name="reach">
					<option value="company">Anyone at Škoda Auto</option>
					<option value="team">Just my team</option>
					<option value="external">People outside the company too</option>
				</select>
			</label>

			<label>
				Does it hold anything about identifiable people — names, contact details, photographs?
				<select name="personalData">
					<option value="yes">Yes, or I am not sure</option>
					<option value="no">No, nothing about individual people</option>
				</select>
			</label>

			<label>
				Does it touch money, safety, or records the company is legally required to keep?
				<select name="critical">
					<option value="no">No</option>
					<option value="yes">Yes, or I am not sure</option>
				</select>
			</label>

			<button type="submit" class="primary">Create and start</button>
		</form>
	{/if}

	{#if data.projects.length === 0 && !creating}
		<div class="empty">
			<p>No applications yet.</p>
			<p class="sub">Create one and the assistant will start asking what you need.</p>
		</div>
	{:else}
		<ul class="grid">
			{#each data.projects as project (project.id)}
				<li>
					<a class="card project" href="/projects/{project.id}">
						<h2>{project.name}</h2>
						<p class="sub">{project.description || 'No description yet'}</p>
						<div class="meter" aria-label="{project.complete} of {project.total} chapters complete">
							<div
								class="fill"
								style="width: {project.total ? (project.complete / project.total) * 100 : 0}%"
							></div>
						</div>
						<div class="stats">
							<span>{project.complete}/{project.total} chapters</span>
							{#if project.open > 0}
								<span class="open">{project.open} open questions</span>
							{/if}
						</div>
					</a>
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
		display: block;
		text-decoration: none;
		color: inherit;
	}

	.project:hover {
		border-color: var(--accent);
	}

	.project h2 {
		font-size: 16px;
		margin-bottom: 2px;
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
