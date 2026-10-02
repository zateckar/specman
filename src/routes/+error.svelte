<script lang="ts">
	import { page } from '$app/state';

	/**
	 * Our own error page, in words. SvelteKit's default showed a bare status code
	 * and the developer's message — "404 No such application", "500 Internal
	 * Error" — to someone who commissions software and does not read status codes.
	 */
	const explanation = $derived.by(() => {
		switch (page.status) {
			case 401:
				return 'You are not signed in any more. Sign in again and you will come back here.';
			case 403:
				return 'This page is only for the people who look after Specman.';
			case 404:
				return 'There is nothing here. The application may have been removed, or the link is incomplete.';
			default:
				return 'Something went wrong on our side. Nothing you did caused it — try again in a minute.';
		}
	});
</script>

<svelte:head><title>Something went wrong — Specman</title></svelte:head>

<main>
	<div class="card">
		<h1>{page.status === 404 ? 'Not found' : page.status === 403 ? 'Not available' : 'Something went wrong'}</h1>
		<p>{explanation}</p>
		<p>
			{#if page.status === 401}
				<a href="/login?next={encodeURIComponent(page.url.pathname)}">Sign in</a>
			{:else}
				<a href="/">Back to your applications</a>
			{/if}
		</p>
	</div>
</main>

<style>
	main {
		flex: 1;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 60px 20px;
	}

	.card {
		max-width: 460px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 22px 24px;
	}

	h1 {
		font-size: 19px;
	}

	p {
		color: var(--ink-soft);
		font-size: 14px;
	}
</style>
