<script lang="ts">
	let { data, form } = $props();
</script>

<svelte:head><title>Sign in — Specman</title></svelte:head>

<main>
	<div class="card">
		<h1>Sign in</h1>
		<p class="sub">Specman helps you describe the application you want built.</p>

		<!-- Reached through the company gateway, which has already said who this
		     is. Carrying on needs nothing; the form below is for another account,
		     such as an administrator's. -->
		{#if data.gatewayUser}
			<div class="gateway">
				<p>The company gateway signed you in as <strong>{data.gatewayUser}</strong>.</p>
				<a class="continue" href={data.next} data-sveltekit-reload>Continue as {data.gatewayUser}</a>
				<p class="note">Or sign in with another account below.</p>
				{#if data.gatewayLogoutUrl}
					<a class="away" href={data.gatewayLogoutUrl} data-sveltekit-reload>Sign out of the company gateway</a>
				{/if}
			</div>
		{/if}

		{#if form?.message}
			<p class="error">{form.message}</p>
		{/if}

		{#snippet passwordForm()}
			<form method="POST">
				<input type="hidden" name="next" value={data.next} />
				<label>
					Username
					<input name="username" value={form?.username ?? ''} autocomplete="username" required />
				</label>
				<label>
					Password
					<input name="password" type="password" autocomplete="current-password" required />
				</label>
				<button type="submit">Sign in</button>
			</form>
		{/snippet}

		<!-- The company account is how everyone signs in. A password is the way back
		     in when the directory is unreachable, so it is present but folded away —
		     and where there is no company account to offer, it is simply the form,
		     with nothing to disclose. -->
		{#if data.oidcAvailable}
			<a class="sso" href="/login/oidc">Sign in with your company account</a>

			<!-- Open for someone the gateway already signed in: another account is what
			     they came here for, and it is usually the administrator's password. -->
			<details open={Boolean(form?.message) || Boolean(data.gatewayUser)}>
				<summary>Use a local account instead</summary>
				{@render passwordForm()}
				<p class="note">
					Company accounts have no password here. If you normally sign in with the button above,
					this will not work for you.
				</p>
			</details>
		{:else}
			{@render passwordForm()}
		{/if}
	</div>
</main>

<style>
	main {
		flex: 1;
		display: grid;
		place-items: center;
		padding: 24px;
	}

	.card {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 28px;
		width: 100%;
		max-width: 360px;
	}

	.sub {
		color: var(--ink-soft);
		margin-top: -4px;
		font-size: 14px;
	}

	label {
		display: block;
		margin-bottom: 14px;
		font-size: 13px;
		color: var(--ink-soft);
	}

	input {
		display: block;
		width: 100%;
		margin-top: 4px;
		padding: 9px 10px;
		font: inherit;
		color: var(--ink);
		border: 1px solid var(--line);
		border-radius: 7px;
		background: #fff;
	}

	input:focus {
		outline: 2px solid var(--accent);
		outline-offset: -1px;
	}

	button {
		width: 100%;
		padding: 10px;
		border: 0;
		border-radius: 7px;
		background: var(--accent);
		color: #fff;
		font-weight: 600;
	}

	.error {
		background: #fdecec;
		border: 1px solid #f3c9c9;
		color: #8c2020;
		padding: 8px 10px;
		border-radius: 7px;
		font-size: 13px;
	}

	.sso {
		display: block;
		text-align: center;
		margin: 4px 0 18px;
		padding: 10px;
		border-radius: 7px;
		background: var(--accent);
		color: #fff;
		font-weight: 600;
		font-size: 14px;
		text-decoration: none;
	}

	summary {
		font-size: 13px;
		color: var(--ink-soft);
		cursor: pointer;
		margin-bottom: 12px;
	}

	.note {
		font-size: 12.5px;
		color: var(--ink-soft);
		margin: 12px 0 0;
	}

	.gateway {
		background: var(--accent-soft);
		border-radius: 7px;
		padding: 12px 14px;
		margin-bottom: 18px;
		font-size: 14px;
	}

	.gateway p {
		margin: 0 0 10px;
	}

	.gateway .note {
		margin: 10px 0 0;
	}

	.continue {
		display: block;
		text-align: center;
		padding: 9px;
		border-radius: 7px;
		border: 1px solid var(--accent);
		background: #fff;
		color: var(--accent);
		font-weight: 600;
		text-decoration: none;
	}

	.away {
		display: inline-block;
		margin-top: 8px;
		font-size: 12.5px;
	}
</style>
