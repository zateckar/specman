<script lang="ts">
	let { data, form } = $props();
</script>

<main>
	<a class="back" href="/">← Back</a>
	<h1>Company standards</h1>

	<div class="card warn">
		<p>
			<strong>These are examples, not policy.</strong> Nobody has approved them. They are switched
			off until someone who owns the real standards reviews them.
		</p>
		<p class="sub">
			A standard that is switched on is copied into every new application it applies to, as
			something already settled. The assistant will not interview anyone about it — it will only
			speak up if what they describe would break one. So a wrong standard here becomes a wrong
			line in every specification, silently.
		</p>
	</div>

	{#if form?.message}<p class="error">{form.message}</p>{/if}
	{#if form?.saved}<p class="ok">Saved.</p>{/if}

	{#each data.standards as standard (standard.id)}
		<form method="POST" action="?/save" class="card">
			<input type="hidden" name="id" value={standard.id} />

			<div class="head">
				<span class="chapter">{standard.chapter_key}</span>
				<label class="toggle">
					<input type="checkbox" name="active" checked={standard.active === 1} />
					In use
				</label>
			</div>

			<label>
				What must always be true
				<textarea name="statement" rows="2">{standard.statement}</textarea>
			</label>

			<label>
				Applies when — any one of these is enough ({data.conditions})
				<input name="appliesWhen" value={standard.applies_when.join(', ')} />
			</label>

			{#if standard.scenarios.length > 0}
				<p class="scenarios">
					{#each standard.scenarios as scenario}
						<span>If {scenario.when}, then {scenario.then}.</span>
					{/each}
				</p>
			{/if}

			<button type="submit">Save</button>
		</form>
	{/each}
</main>

<style>
	main {
		padding: 24px;
		max-width: 780px;
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

	.card {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 16px;
		margin-bottom: 14px;
	}

	.warn {
		background: var(--warn-soft);
		border-color: #eddcb8;
	}

	.warn p {
		margin: 0;
		font-size: 13.5px;
	}

	.warn .sub {
		margin-top: 8px;
		font-size: 12.5px;
		color: #6f4a0d;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 10px;
	}

	.chapter {
		font-family: var(--mono);
		font-size: 12px;
		color: var(--ink-soft);
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		margin: 0;
	}

	.toggle input {
		width: auto;
		margin: 0;
	}

	label {
		display: block;
		font-size: 13px;
		color: var(--ink-soft);
		margin-bottom: 12px;
	}

	textarea,
	input {
		display: block;
		width: 100%;
		margin-top: 4px;
		padding: 8px 10px;
		font: inherit;
		border: 1px solid var(--line);
		border-radius: 8px;
	}

	.scenarios {
		font-size: 12.5px;
		color: var(--ink-soft);
		margin: 0 0 12px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	button {
		background: var(--accent);
		color: #fff;
		border: 0;
		border-radius: 8px;
		padding: 8px 16px;
		font-weight: 600;
	}

	.error,
	.ok {
		font-size: 13px;
		padding: 8px 10px;
		border-radius: 7px;
		margin-bottom: 12px;
	}

	.error {
		background: #fdecec;
		color: #8c2020;
	}

	.ok {
		background: var(--accent-soft);
		color: var(--ok);
	}
</style>
