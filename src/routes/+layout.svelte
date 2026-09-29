<script lang="ts">
	let { children, data } = $props();
</script>

<svelte:head>
	<title>Specman</title>
</svelte:head>

<div class="app">
	<header>
		<a class="brand" href="/">Specman</a>
		<span class="tagline">Application design, guided</span>
		<div class="spacer"></div>
		{#if data?.user}
			{#if data.user.is_admin}
				<a class="admin" href="/admin/templates">Template</a>
				<a class="admin" href="/admin/standards">Standards</a>
				<a class="admin" href="/admin/users">People</a>
			{/if}
			<span class="who">{data.user.display_name}</span>
			{#if !data.viaProxy}
				<form method="POST" action="/logout">
					<button type="submit" class="link">Sign out</button>
				</form>
			{:else if data.proxyLogoutUrl}
				<a class="link" href={data.proxyLogoutUrl} data-sveltekit-reload>Sign out</a>
			{:else}
				<span class="who" title="You were signed in by the company gateway. Closing the browser ends it.">
					signed in by the gateway
				</span>
			{/if}
		{/if}
	</header>
	{@render children()}
</div>

<style>
	:global(:root) {
		--bg: #f6f7f6;
		--panel: #ffffff;
		--ink: #16201c;
		--ink-soft: #5c6b64;
		--line: #dfe4e1;
		--accent: #0e5340;
		--accent-soft: #e6efeb;
		--warn: #9a6412;
		--warn-soft: #fdf4e4;
		--ok: #1c6b45;
		--radius: 10px;
		--mono: ui-monospace, 'Cascadia Code', 'Consolas', monospace;
	}

	:global(*) {
		box-sizing: border-box;
	}

	:global(body) {
		margin: 0;
		background: var(--bg);
		color: var(--ink);
		font: 15px/1.55 system-ui, -apple-system, 'Segoe UI', sans-serif;
	}

	:global(h1, h2, h3, h4) {
		line-height: 1.25;
		margin: 0 0 0.5em;
	}

	:global(button) {
		font: inherit;
		cursor: pointer;
	}

	:global(a) {
		color: var(--accent);
	}

	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
	}

	header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 0 16px;
		height: 52px;
		flex: 0 0 auto;
		background: var(--panel);
		border-bottom: 1px solid var(--line);
	}

	.brand {
		font-weight: 700;
		font-size: 17px;
		color: var(--accent);
		text-decoration: none;
		letter-spacing: -0.01em;
	}

	.tagline {
		color: var(--ink-soft);
		font-size: 13px;
	}

	.spacer {
		flex: 1;
	}

	.who {
		font-size: 13px;
		color: var(--ink-soft);
	}

	.admin {
		font-size: 13px;
		text-decoration: none;
	}

	.link {
		background: none;
		border: 0;
		color: var(--accent);
		font-size: 13px;
		padding: 4px;
		text-decoration: none;
	}

	form {
		display: contents;
	}
</style>
