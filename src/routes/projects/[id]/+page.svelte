<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import AgentChat from '$lib/components/AgentChat.svelte';
	import ChapterIndex from '$lib/components/ChapterIndex.svelte';
	import DocumentPreview from '$lib/components/DocumentPreview.svelte';
	import { nextChapter } from '$lib/next-chapter';
	import { readFrames } from '$lib/sse';

	type Status = 'empty' | 'in_progress' | 'complete';

	let { data } = $props();

	// Local mirror so the index and preview update live during a turn, without
	// waiting for a round trip. Each is overwritten as the stream arrives and
	// re-derived whenever the server sends new data.
	let chapters = $derived([...data.chapters]);
	let requirements = $derived([...data.requirements]);
	let decisions = $derived([...data.decisions]);
	let pendingChanges = $derived(data.pendingChanges);

	const active = $derived(chapters.find((c) => c.key === data.activeKey) ?? null);
	const chatTitle = $derived(active ? active.title : 'Whole document');
	// Only the active chapter's questions are offered, because answering one adds
	// the exchange to that chapter's conversation. The index carries the totals.
	const openQuestions = $derived(active ? active.open_questions : []);
	// Offered once the active chapter is done, so finishing one is not a dead end.
	const finished = $derived(active?.status === 'complete' && openQuestions.length === 0);
	const next = $derived(finished ? nextChapter(chapters, data.activeKey) : null);

	function applyChapter(key: string, markdown: string) {
		chapters = chapters.map((c) => (c.key === key ? { ...c, content_md: markdown } : c));
	}

	function applyState(key: string, status: string, questions: string[]) {
		chapters = chapters.map((c) =>
			c.key === key ? { ...c, status: status as Status, open_questions: questions } : c
		);
	}

	type Scope = 'now' | 'later' | 'out';
	type RequirementView = (typeof data.requirements)[number];

	/** The stream carries a `removed` flag the view does not; drop it here. */
	function applyRequirement(payload: Record<string, any>) {
		const rest = requirements.filter((r) => r.ref !== payload.ref);
		if (payload.removed) {
			requirements = rest;
			return;
		}

		const requirement: RequirementView = {
			ref: payload.ref,
			chapter_key: payload.chapter_key,
			statement: payload.statement,
			scope: payload.scope as Scope,
			scenarios: payload.scenarios ?? []
		};
		requirements = [...rest, requirement];
	}

	function applyDecision(payload: Record<string, any>) {
		const rest = decisions.filter((d) => d.id !== payload.id);
		decisions = [
			...rest,
			{
				id: payload.id,
				chapter_key: payload.chapter_key,
				statement: payload.statement,
				rationale: payload.rationale ?? '',
				source: payload.source,
				status: payload.status
			}
		];
	}

	function onCommit() {
		pendingChanges = true;
		// Refresh server state (diff, transcript) without disturbing the panes.
		invalidateAll();
	}

	/* ------------------------------------------------------- running a turn */

	/**
	 * The turn lives here, not in the chat pane.
	 *
	 * The pane is keyed on the chapter, so it is destroyed and rebuilt whenever
	 * the user opens a different one. While the turn lived there, switching
	 * chapters mid-reply left it running against a component nobody could see:
	 * the server finished the work — it always did — but the index, the preview
	 * and the review indicator went on showing what was true before it started.
	 * This page outlives the switch, so it is the only place the turn can be
	 * owned from.
	 */
	type ChatTurn = { role: 'user' | 'assistant'; content: string; options?: AnswerOption[] };
	type AnswerOption = { label: string; recommended: boolean };

	let running = $state<{ key: string; title: string; turns: ChatTurn[] } | null>(null);
	let errorMessage = $state('');
	let commitFailed = $state(false);

	const activeKey = $derived(data.activeKey ?? '');
	const busyHere = $derived(running !== null && running.key === activeKey);
	// A turn still going in a chapter the user has left. Named, so they can see
	// where their answer went rather than assuming it was dropped.
	const busyElsewhere = $derived(running !== null && running.key !== activeKey ? running.title : '');
	const shownTurns = $derived<ChatTurn[]>(busyHere ? running!.turns : (data.messages as ChatTurn[]));

	const saveState = $derived<'saved' | 'saving' | 'not-recorded'>(
		running !== null ? 'saving' : commitFailed ? 'not-recorded' : 'saved'
	);

	function appendTurn(turn: ChatTurn) {
		if (running) running.turns = [...running.turns, turn];
	}

	function updateLast(change: (turn: ChatTurn) => void) {
		if (!running) return;
		const last = running.turns[running.turns.length - 1];
		if (last?.role !== 'assistant') return;
		change(last);
		running.turns = [...running.turns];
	}

	async function runTurn(message: string) {
		if (running) return;

		const key = activeKey;
		running = {
			key,
			title: chatTitle,
			turns: [
				...(data.messages as ChatTurn[]),
				{ role: 'user', content: message },
				{ role: 'assistant', content: '' }
			]
		};
		errorMessage = '';
		commitFailed = false;

		try {
			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ projectId: data.project.id, chapterKey: data.activeKey, message })
			});
			if (!response.ok || !response.body) throw new Error(`Request failed (${response.status})`);

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const { events, rest } = readFrames(buffer);
				buffer = rest;

				for (const { name, data: payload } of events) {
					const body = payload as Record<string, any>;
					if (name === 'text') updateLast((turn) => (turn.content += body.delta));
					else if (name === 'options') updateLast((turn) => (turn.options = body.options));
					else if (name === 'chapter') applyChapter(body.key, body.markdown);
					else if (name === 'requirement') applyRequirement(body);
					else if (name === 'decision') applyDecision(body);
					else if (name === 'state') applyState(body.key, body.status, body.openQuestions);
					// A commit, or a change to the shape of the chapter list — either way
					// only the server knows what the document looks like now.
					else if (name === 'commit' || name === 'sections') onCommit();
					else if (name === 'error') {
						errorMessage = body.message;
						// The turn's own message says the change is not in the history yet.
						// The indicator has to agree with it, or the header quietly claims
						// everything is saved while the text underneath says otherwise.
						commitFailed = String(body.message ?? '').includes('history');
					}
				}
			}
		} catch (cause) {
			errorMessage =
				cause instanceof Error ? cause.message : 'Something went wrong. Please try again.';
		} finally {
			// Whatever the user is looking at now, bring it up to date with the turn
			// that has just finished — including when that is a different chapter.
			// Only then let go of the turn: released first, the pane fell back to
			// the transcript as it was before the turn, and the reply vanished
			// until the reload arrived.
			await settle();
		}
	}

	async function settle() {
		try {
			await invalidateAll();
		} catch (cause) {
			console.warn('could not refresh after the turn:', cause);
		} finally {
			running = null;
		}
	}

	/**
	 * Open questions belong to the agent, so clicking one makes the agent ask it.
	 * Sending it as a user message would have the user asking their own question
	 * and the agent answering on their behalf — the decision is the user's.
	 */
	async function askQuestion(question: string) {
		if (running) return;

		const key = activeKey;
		running = { key, title: chatTitle, turns: [...(data.messages as ChatTurn[])] };
		appendTurn({ role: 'assistant', content: question });

		try {
			const response = await fetch('/api/ask', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					projectId: data.project.id,
					chapterKey: data.activeKey,
					question
				})
			});
			if (!response.ok) throw new Error(`Request failed (${response.status})`);

			const { options } = await response.json();
			updateLast((turn) => (turn.options = options));
		} catch (cause) {
			// The question is already on screen and stored; suggestions are a bonus.
			console.warn('could not suggest answers:', cause);
		} finally {
			await settle();
		}
	}

	/* ------------------------------------------------- who else is in here */

	let others = $state<Array<{ name: string; writing: boolean }>>([]);

	$effect(() => {
		const projectId = data.project.id;
		let stopped = false;

		async function ping() {
			try {
				const response = await fetch('/api/presence', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ projectId })
				});
				if (response.ok && !stopped) others = (await response.json()).others ?? [];
			} catch {
				// Knowing who else is here is a courtesy, not a requirement. If it
				// cannot be answered, say nobody rather than showing an error for it.
			}
		}

		void ping();
		const timer = setInterval(ping, 15_000);
		return () => {
			stopped = true;
			clearInterval(timer);
		};
	});
</script>

<div class="workspace">
	<ChapterIndex {chapters} activeKey={data.activeKey} projectId={data.project.id} {others} />

	<!-- Keyed on the chapter so switching chapters starts a fresh transcript. The
	     turn itself is owned by this page, so the remount no longer interrupts it. -->
	{#key data.activeKey}
		<AgentChat
			projectId={data.project.id}
			chapterKey={data.activeKey}
			chapterTitle={chatTitle}
			written={!!active?.content_md?.trim()}
			turns={shownTurns}
			busy={busyHere}
			{busyElsewhere}
			{saveState}
			{errorMessage}
			{openQuestions}
			{finished}
			next={next ? { key: next.key, title: next.title } : null}
			onsend={runTurn}
			onask={askQuestion}
		/>
	{/key}

	<DocumentPreview
		projectName={data.project.name}
		{chapters}
		{requirements}
		{decisions}
		findings={data.findings}
		activeKey={data.activeKey}
		{pendingChanges}
		projectId={data.project.id}
	/>
</div>

<style>
	.workspace {
		flex: 1;
		display: grid;
		grid-template-columns: 270px minmax(340px, 1fr) minmax(360px, 1.15fr);
		min-height: 0;
	}

	@media (max-width: 1100px) {
		.workspace {
			grid-template-columns: 220px 1fr;
		}
		.workspace > :global(aside) {
			display: none;
		}
	}
</style>
