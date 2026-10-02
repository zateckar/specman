<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import AgentChat from '$lib/components/AgentChat.svelte';
	import ChapterIndex from '$lib/components/ChapterIndex.svelte';
	import DocumentPreview from '$lib/components/DocumentPreview.svelte';
	import { describeActivity, wordCount, type Activity } from '$lib/activity';
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

	let running = $state<{
		key: string;
		title: string;
		turns: ChatTurn[];
		/** What the assistant is doing, as the turn last said. */
		activity: Activity | null;
		/** The chapter being written, its text so far, and how long it is. */
		writing: { key: string; words: number } | null;
	} | null>(null);
	/** Chapter text as it arrives, per chapter. Not state: the preview is fed through `applyChapter`. */
	const drafting = new Map<string, string>();
	/** Which pane a narrow window shows. Wide windows show both and ignore it. */
	let pane = $state<'chat' | 'document'>('chat');
	let errorMessage = $state('');
	let commitFailed = $state(false);

	const activeKey = $derived(data.activeKey ?? '');
	const busyHere = $derived(running !== null && running.key === activeKey);
	// A turn still going in a chapter the user has left. Named, so they can see
	// where their answer went rather than assuming it was dropped.
	const busyElsewhere = $derived(running !== null && running.key !== activeKey ? running.title : '');
	const shownTurns = $derived<ChatTurn[]>(busyHere ? running!.turns : (data.messages as ChatTurn[]));
	const activityText = $derived.by(() => {
		if (!running) return '';
		const key = running.activity?.chapter ?? null;
		const title = key ? (chapters.find((c) => c.key === key)?.title ?? null) : null;
		return describeActivity(running.activity, title, running.writing?.key === key ? running.writing.words : 0);
	});

	/**
	 * More of a chapter the assistant is writing. Shown in the preview as it
	 * arrives; nothing is saved until the turn is, and the refresh at the end of
	 * the turn puts the stored text back if it fails.
	 */
	function applyDraft(body: Record<string, any>) {
		if (!running) return;
		const key = String(body.chapter);
		const text = typeof body.markdown === 'string' ? body.markdown : (drafting.get(key) ?? '') + String(body.delta ?? '');
		drafting.set(key, text);
		applyChapter(key, text);
		running.writing = { key, words: wordCount(text) };
	}

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

	/**
	 * Why a turn never started, in words the user can act on.
	 *
	 * "Request failed (500)" was what they saw before, and the answer they had
	 * written was gone from the box with it.
	 */
	function refusal(response: Response): string {
		if (response.status === 401 || response.redirected) {
			return 'You have been signed out. Sign in again in another tab, then send your answer — it is back in the box.';
		}
		if (response.status === 404) return 'This application could not be found any more. Reload the page.';
		return 'Your answer could not be sent just now. It is back in the box — try again in a minute.';
	}

	/** Shown together: a later problem in the same turn used to replace the earlier one. */
	function addError(message: string) {
		errorMessage = errorMessage ? `${errorMessage}\n${message}` : message;
	}

	/**
	 * Run one turn. Resolves false when the answer never reached the server, so
	 * the chat can put it back in the box rather than losing it.
	 */
	async function runTurn(message: string): Promise<boolean> {
		if (running) return false;

		const key = activeKey;
		running = {
			key,
			title: chatTitle,
			turns: [
				...(data.messages as ChatTurn[]),
				{ role: 'user', content: message },
				{ role: 'assistant', content: '' }
			],
			activity: null,
			writing: null
		};
		drafting.clear();
		errorMessage = '';
		commitFailed = false;
		let delivered = false;

		try {
			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ projectId: data.project.id, chapterKey: data.activeKey, message })
			});
			// A session that expired is answered with the sign-in page, which fetch
			// follows and reports as a success: the turn ended with nothing at all.
			const streamed = (response.headers.get('content-type') ?? '').startsWith('text/event-stream');
			if (!response.ok || !response.body || !streamed) {
				addError(refusal(response));
				return false;
			}
			delivered = true;

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let finished = false;
			let failed = false;

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
					else if (name === 'activity') {
						if (running) running.activity = { doing: String(body.doing), chapter: body.chapter ?? null };
					} else if (name === 'drafting') applyDraft(body);
					else if (name === 'chapter') {
						applyChapter(body.key, body.markdown);
						// Saved now, so no longer "being written".
						if (running?.writing?.key === body.key) running.writing = null;
					}
					else if (name === 'requirement') applyRequirement(body);
					else if (name === 'decision') applyDecision(body);
					else if (name === 'state') applyState(body.key, body.status, body.openQuestions);
					// A commit, or a change to the shape of the chapter list — either way
					// only the server knows what the document looks like now.
					else if (name === 'commit' || name === 'sections') onCommit();
					else if (name === 'done') finished = true;
					else if (name === 'error') {
						failed = true;
						addError(String(body.message ?? ''));
						// The turn's own message says the change is not in the history yet.
						// The indicator has to agree with it, or the header quietly claims
						// everything is saved while the text underneath says otherwise.
						if (String(body.message ?? '').includes('history')) commitFailed = true;
					}
				}
			}

			// The stream stopped without the server saying it had finished — a proxy
			// that gave up on a quiet connection, or the network. The turn itself goes
			// on running on the server.
			if (!finished && !failed) {
				addError(
					'The connection was lost before the reply finished. The assistant carries on with it — ' +
						'reload the page in a minute to see what it wrote.'
				);
			}
			return true;
		} catch {
			addError(
				delivered
					? 'The connection was lost before the reply finished. The assistant carries on with it — reload the page in a minute to see what it wrote.'
					: 'Your answer could not be sent — the connection failed. It is back in the box; try again in a minute.'
			);
			return delivered;
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
		running = { key, title: chatTitle, turns: [...(data.messages as ChatTurn[])], activity: null, writing: null };
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

<svelte:head><title>{active ? `${active.title} — ` : ''}{data.project.name} — Specman</title></svelte:head>

<div class="workspace" class:reading={pane === 'document'}>
	<ChapterIndex {chapters} activeKey={data.activeKey} projectId={data.project.id} {others} />

	<!-- Only on a narrow window, where the conversation and the document no longer
	     fit side by side. -->
	<div class="pane-switch">
		<button type="button" aria-pressed={pane === 'chat'} onclick={() => (pane = 'chat')}>Conversation</button>
		<button type="button" aria-pressed={pane === 'document'} onclick={() => (pane = 'document')}>
			Document{#if pendingChanges}<span class="dot" aria-label="(changes waiting for review)"></span>{/if}
		</button>
	</div>

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
			activity={activityText}
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
		writingKey={running?.writing?.key ?? null}
	/>
</div>

<style>
	.workspace {
		flex: 1;
		display: grid;
		grid-template-columns: 270px minmax(340px, 1fr) minmax(360px, 1.15fr);
		min-height: 0;
	}

	.pane-switch {
		display: none;
	}

	/* The document pane holds the only way to review, the diagram, the handoff and
	   the confirmations, so a narrow window switches between it and the
	   conversation. It used to be hidden outright — on a 1366px laptop at 125%
	   scaling, which is an ordinary office screen. */
	@media (max-width: 1100px) {
		.workspace {
			grid-template-columns: 220px 1fr;
			grid-template-rows: auto 1fr;
		}
		.workspace > :global(nav) {
			grid-row: 1 / span 2;
		}
		.pane-switch {
			display: flex;
			gap: 4px;
			grid-column: 2;
			grid-row: 1;
			padding: 6px 10px;
			border-bottom: 1px solid var(--line);
			background: var(--panel);
		}
		.pane-switch button {
			border: 1px solid var(--line);
			background: var(--bg);
			border-radius: 7px;
			padding: 5px 14px;
			font-size: 13px;
		}
		.pane-switch button[aria-pressed='true'] {
			background: var(--accent-soft);
			border-color: var(--accent);
			color: var(--accent);
			font-weight: 600;
		}
		.pane-switch .dot {
			display: inline-block;
			width: 7px;
			height: 7px;
			margin-left: 6px;
			border-radius: 50%;
			background: var(--warn);
			vertical-align: middle;
		}
		.workspace > :global(section),
		.workspace > :global(aside) {
			grid-column: 2;
			grid-row: 2;
			min-height: 0;
		}
		.workspace:not(.reading) > :global(aside),
		.workspace.reading > :global(section) {
			display: none;
		}
	}
</style>
