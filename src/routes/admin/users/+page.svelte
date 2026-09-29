<script lang="ts">
	let { data, form } = $props();

	type Person = { sso: boolean; hasPassword: boolean; createdVia: string };

	/**
	 * Someone the gateway signs in has no password and no linked company account,
	 * and that is the ordinary case, not a broken one. Reading the two credential
	 * columns alone reported everybody in a proxied installation as unable to sign
	 * in, on a page whose purpose is deciding who may do what.
	 */
	function signsInWith(user: Person): string {
		const ways: string[] = [];
		if (user.createdVia === 'proxy') ways.push('The gateway');
		if (user.sso) ways.push(ways.length ? 'a company account' : 'Company account');
		if (user.hasPassword) ways.push(ways.length ? 'a password' : 'Password');

		if (ways.length === 0) return 'Cannot sign in yet';
		if (ways.length === 1) return ways[0];
		return `${ways.slice(0, -1).join(', ')}, and ${ways[ways.length - 1]}`;
	}

	function nothingToSignInWith(user: Person): boolean {
		return !user.sso && !user.hasPassword && user.createdVia !== 'proxy';
	}
</script>

<main>
	<a class="back" href="/">← Back</a>
	<h1>People</h1>

	<p class="lede">
		Anyone who signs in — through the gateway or with their company account — appears here as an
		ordinary user. Signing in says who someone is; it does not say what they may do. Administrator
		rights are granted here, by an administrator, and never by the gateway or the company
		directory.
	</p>

	{#if form?.message}<p class="error">{form.message}</p>{/if}
	{#if form?.saved}<p class="ok">Saved.</p>{/if}

	<div class="card">
		<table>
			<thead>
				<tr>
					<th>Name</th>
					<th>Signs in with</th>
					<th>Administrator</th>
				</tr>
			</thead>
			<tbody>
				{#each data.users as user (user.id)}
					<tr>
						<td>
							<span class="name">{user.display_name}</span>
							<span class="username">{user.username}{user.id === data.me ? ' — you' : ''}</span>
						</td>
						<td class="how">
							{signsInWith(user)}
							{#if nothingToSignInWith(user)}
								<span class="hint">no password set, and no company account linked</span>
							{:else if user.createdVia === 'proxy' && !user.hasPassword}
								<span class="hint">signed in by the gateway, with no password of their own</span>
							{/if}
						</td>
						<td>
							<form method="POST" action="?/rights">
								<input type="hidden" name="id" value={user.id} />
								<input type="hidden" name="admin" value={user.is_admin ? 'no' : 'yes'} />
								<button type="submit" class={user.is_admin ? 'on' : 'off'}>
									{user.is_admin ? 'Yes — withdraw' : 'No — grant'}
								</button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
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
		margin: 10px 0 8px;
	}

	.lede {
		color: var(--ink-soft);
		font-size: 13.5px;
		margin: 0 0 16px;
		max-width: 62ch;
	}

	.card {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 4px 16px;
	}

	table {
		width: 100%;
		border-collapse: collapse;
	}

	th {
		text-align: left;
		font-size: 12px;
		font-weight: 600;
		color: var(--ink-soft);
		padding: 12px 8px;
		border-bottom: 1px solid var(--line);
	}

	td {
		padding: 12px 8px;
		border-bottom: 1px solid var(--line);
		vertical-align: top;
	}

	tr:last-child td {
		border-bottom: 0;
	}

	.name {
		display: block;
		font-size: 14px;
	}

	.username {
		display: block;
		font-family: var(--mono);
		font-size: 12px;
		color: var(--ink-soft);
	}

	.how {
		font-size: 13px;
		color: var(--ink-soft);
	}

	.hint {
		display: block;
		font-size: 12px;
		color: var(--warn);
	}

	button {
		border-radius: 8px;
		padding: 6px 12px;
		font-size: 13px;
		font-weight: 600;
		border: 1px solid var(--line);
		background: var(--panel);
		color: var(--ink-soft);
		white-space: nowrap;
	}

	button.on {
		background: var(--accent-soft);
		border-color: #bcd6cc;
		color: var(--accent);
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
