<script lang="ts" module>
	/**
	 * Unsent answers, per chapter. The pane is rebuilt on every chapter switch,
	 * so a draft held in the component was thrown away by looking at another
	 * chapter — a dictated paragraph included.
	 */
	const drafts = new Map<string, string>();
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import Dictation from './Dictation.svelte';

	interface AnswerOption {
		label: string;
		recommended: boolean;
	}

	interface ChatTurn {
		role: 'user' | 'assistant';
		content: string;
		options?: AnswerOption[];
	}

	/**
	 * The conversation pane. It shows a turn and collects the next one; it does
	 * not run one.
	 *
	 * Running the turn used to live here, and the component is replaced whenever
	 * the chapter changes — so switching chapters mid-reply orphaned the work.
	 * The page owns it now and survives the switch, which is the only place that
	 * can be true.
	 */
	let {
		projectId,
		chapterKey,
		chapterTitle,
		written = false,
		turns,
		busy,
		busyElsewhere = '',
		saveState = 'saved',
		errorMessage = '',
		openQuestions,
		finished = false,
		next = null,
		onsend,
		onask
	}: {
		projectId: number;
		chapterKey: string | null;
		chapterTitle: string;
		/** Has prose already, even though nothing has been said about it here. */
		written?: boolean;
		turns: ChatTurn[];
		busy: boolean;
		/** Title of another chapter still being written, if there is one. */
		busyElsewhere?: string;
		saveState?: 'saved' | 'saving' | 'not-recorded';
		errorMessage?: string;
		openQuestions: string[];
		/** This chapter is complete with nothing left to ask. */
		finished?: boolean;
		/** The chapter to offer next — chosen by the application, not the agent. */
		next?: { key: string; title: string } | null;
		/** Resolves false when the answer never reached the server. */
		onsend: (text: string) => Promise<boolean> | void;
		onask: (question: string) => void;
	} = $props();

	// The pane is rebuilt per chapter, so these are read once on purpose.
	// svelte-ignore state_referenced_locally
	const draftKey = `${projectId}:${chapterKey ?? ''}`;
	let input = $state(drafts.get(draftKey) ?? '');
	let box: HTMLTextAreaElement | undefined = $state();
	let scroller: HTMLDivElement | undefined = $state();
	let dictation: Dictation | undefined = $state();
	let listening = $state(false);
	let dictationStatus = $state('');

	$effect(() => {
		if (input) drafts.set(draftKey, input);
		else drafts.delete(draftKey);
	});

	// Nothing can be sent while any turn is running. The page runs one turn at a
	// time, so an answer sent while another chapter was still being written was
	// cleared from the box and silently dropped.
	const blocked = $derived(busy || !!busyElsewhere);

	// The box is disabled while the reply is written, which takes focus away
	// from it. Hand it back when the reply is done, so the next answer can be
	// typed without reaching for the mouse.
	let wasBusy = false;
	$effect(() => {
		const now = busy;
		if (wasBusy && !now) void tick().then(() => box?.focus());
		wasBusy = now;
	});

	// Follow the reply as it streams, and land at the bottom on a chapter switch.
	$effect(() => {
		turns.length;
		turns[turns.length - 1]?.content;
		scrollDown();
	});

	// Only the newest agent turn offers its answers: older ones have been answered
	// already, and leaving them clickable invites the user to answer twice.
	const liveOptions = $derived(
		!busy && turns[turns.length - 1]?.role === 'assistant'
			? (turns[turns.length - 1].options ?? [])
			: []
	);

	function scrollDown() {
		requestAnimationFrame(() => {
			if (scroller) scroller.scrollTop = scroller.scrollHeight;
		});
	}

	async function send(text: string) {
		if (!text.trim() || blocked) return;
		// What is on screen is what is sent; nothing heard after this point lands.
		dictation?.cancel();
		input = '';
		// Cleared at once so the box is ready for the next answer, and put back if
		// this one never arrived — it used to vanish with the error. Through the
		// draft store too, in case the user has moved to another chapter since.
		if ((await onsend(text)) === false && !drafts.get(draftKey)) {
			drafts.set(draftKey, text);
			input = text;
		}
	}

	/** A clicked answer is sent as it is; whatever was being typed is kept. */
	function choose(label: string) {
		if (blocked) return;
		dictation?.cancel();
		void onsend(label);
	}

	// Clicking "Start" is the user asking to begin, so it reads as a user turn.
	const startMessage = $derived(
		!chapterKey
			? "Let's review the document as a whole."
			: written
				? "Let's go through this chapter — check what's there and fill in what's missing."
				: "Let's start this chapter."
	);

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			send(input);
		}
	}
</script>

<section>
	<header>
		<h2>{chapterTitle}</h2>
		{#if busy}
			<span class="thinking">Thinking…</span>
		{:else if busyElsewhere}
			<!-- A turn keeps running when the user moves on, so say where it is
			     rather than leaving them wondering whether it was lost. -->
			<span class="thinking">Still writing {busyElsewhere}…</span>
		{/if}
		<span class="spacer"></span>
		<span class="saved" class:working={saveState !== 'saved'} class:adrift={saveState === 'not-recorded'}>
			{#if saveState === 'saving'}Saving…
			{:else if saveState === 'not-recorded'}Not yet in the history
			{:else}All changes saved{/if}
		</span>
	</header>

	<!-- A log, so a screen reader announces each new turn; busy while the reply
	     streams, so it is read once it is whole rather than word by word. -->
	<div class="scroll" bind:this={scroller} role="log" aria-live="polite" aria-busy={busy} aria-label="Conversation">

		{#if turns.length === 0}
			<div class="intro">
				<p>
					{#if chapterKey && written}
						<!-- Written elsewhere: as part of a chapter that was later split, or in
						     passing while another chapter was being discussed. Saying "nothing
						     has been written" here would contradict the document alongside it. -->
						<strong>{chapterTitle}</strong> is already written — we just haven't talked about
						it here yet.
					{:else if chapterKey}
						Nothing has been written for <strong>{chapterTitle}</strong> yet.
					{:else}
						This is where we look at the document as a whole — how the chapters fit together,
						and what still contradicts what.
					{/if}
				</p>
				<button class="start" onclick={() => choose(startMessage)} disabled={blocked}>
					{#if !chapterKey}Start a review{:else if written}Go through it{:else}Start this chapter{/if}
				</button>
				<p class="hint">
					{#if chapterKey && written}
						I'll check what is there with you and ask about anything still missing.
					{:else if chapterKey}
						I'll ask you a few questions and write the chapter from your answers. You can also
						just tell me what you already know.
					{:else}
						Or ask me anything about the document.
					{/if}
				</p>
			</div>
		{/if}

		{#each turns as turn, i (i)}
			<div class="turn {turn.role}">
				<div class="bubble">
					{#if turn.content}
						{turn.content}
					{:else}
						<span class="cursor">▊</span>
					{/if}
				</div>
			</div>
		{/each}

		{#if liveOptions.length > 0}
			<div class="options">
				{#each liveOptions as option}
					<button
						class="option"
						class:recommended={option.recommended}
						onclick={() => choose(option.label)}
						disabled={blocked}
					>
						<span class="label">{option.label}</span>
						{#if option.recommended}<span class="tag">Recommended</span>{/if}
					</button>
				{/each}
				<p class="own">…or type your own answer below.</p>
			</div>
		{/if}

		{#if errorMessage}
			<p class="error" role="alert">{errorMessage}</p>
		{/if}
	</div>

	{#if openQuestions.length > 0 && !busy}
		<div class="pending">
			<span class="pending-label">Still to decide — pick one to work through it:</span>
			<div class="chips">
				{#each openQuestions.slice(0, 3) as question}
					<button class="chip" onclick={() => onask(question)} disabled={blocked}>{question}</button>
				{/each}
			</div>
		</div>
	{:else if finished && !busy}
		<div class="finished">
			<span class="finished-label">This chapter is complete.</span>
			{#if next}
				<a class="next" href="/projects/{projectId}?chapter={next.key}">Continue with {next.title} →</a>
			{:else}
				<a class="next" href="/projects/{projectId}">Every chapter is complete — review the whole document →</a>
			{/if}
		</div>
	{/if}

	<div class="composer">
		<div class="row">
			<!-- Read-only while listening: the recogniser rewrites the box as it revises
			     what it heard, and would overwrite anything typed in the meantime. -->
			<textarea
				bind:this={box}
				bind:value={input}
				onkeydown={onKeydown}
				placeholder={listening ? 'Listening…' : 'Type your answer…'}
				aria-label="Your answer"
				rows="2"
				disabled={busy}
				readonly={listening}
			></textarea>
			<Dictation
				bind:this={dictation}
				bind:value={input}
				bind:listening
				bind:status={dictationStatus}
				disabled={busy}
			/>
			<button class="send" onclick={() => send(input)} disabled={blocked || !input.trim()}>Send</button>
		</div>
		{#if dictationStatus}
			<p class="dictation-status" class:live={listening} role="status">{dictationStatus}</p>
		{/if}
	</div>
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-width: 0;
		background: var(--panel);
		border-right: 1px solid var(--line);
	}

	header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--line);
		flex: 0 0 auto;
	}

	h2 {
		font-size: 15px;
		margin: 0;
	}

	.thinking {
		font-size: 12px;
		color: var(--ink-soft);
	}

	.spacer {
		flex: 1;
	}

	.saved {
		font-size: 12px;
		color: var(--ok);
		white-space: nowrap;
	}

	.saved.working {
		color: var(--ink-soft);
	}

	.saved.adrift {
		color: var(--warn);
		font-weight: 600;
	}

	.scroll {
		flex: 1;
		overflow-y: auto;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.intro {
		color: var(--ink-soft);
		font-size: 14px;
	}

	.start {
		display: block;
		margin: 14px 0 10px;
		background: var(--accent);
		color: #fff;
		border: 0;
		border-radius: 8px;
		padding: 10px 18px;
		font-weight: 600;
		font-size: 14px;
	}

	.start:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.hint {
		font-size: 13px;
		margin: 0;
	}

	.options {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		margin-top: 2px;
	}

	.option {
		display: flex;
		align-items: center;
		gap: 8px;
		max-width: 85%;
		text-align: left;
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 8px 12px;
		font-size: 13.5px;
	}

	.option:hover:not(:disabled) {
		border-color: var(--accent);
	}

	.option:disabled,
	.chip:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.option.recommended {
		border-color: var(--accent);
		background: var(--accent-soft);
	}

	.tag {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--ok);
		white-space: nowrap;
	}

	.own {
		font-size: 12.5px;
		color: var(--ink-soft);
		margin: 2px 0 0;
	}

	.pending {
		padding: 0 16px 10px;
		flex: 0 0 auto;
	}

	.pending-label {
		display: block;
		font-size: 11.5px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--warn);
		margin-bottom: 6px;
	}

	.finished {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 12px;
		padding: 0 16px 10px;
		flex: 0 0 auto;
	}

	.finished-label {
		font-size: 12.5px;
		color: var(--ok);
	}

	.next {
		background: var(--accent);
		color: #fff;
		border-radius: 8px;
		padding: 7px 14px;
		font-size: 13px;
		font-weight: 600;
		text-decoration: none;
	}

	.turn {
		display: flex;
	}

	.turn.user {
		justify-content: flex-end;
	}

	.bubble {
		max-width: 85%;
		padding: 9px 12px;
		border-radius: 12px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-size: 14px;
	}

	.turn.assistant .bubble {
		background: var(--bg);
		border: 1px solid var(--line);
		border-bottom-left-radius: 4px;
	}

	.turn.user .bubble {
		background: var(--accent);
		color: #fff;
		border-bottom-right-radius: 4px;
	}

	.cursor {
		opacity: 0.4;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.chip {
		background: var(--warn-soft);
		border: 1px solid #eddcb8;
		color: #6f4a0d;
		border-radius: 14px;
		padding: 5px 11px;
		font-size: 12.5px;
		text-align: left;
	}

	.chip:hover:not(:disabled) {
		border-color: var(--warn);
	}

	.composer {
		padding: 12px 16px;
		border-top: 1px solid var(--line);
		flex: 0 0 auto;
	}

	.row {
		display: flex;
		gap: 8px;
	}

	.dictation-status {
		margin: 6px 0 0;
		font-size: 12px;
		color: var(--ink-soft);
	}

	.dictation-status.live {
		color: #b02a2a;
	}

	textarea {
		flex: 1;
		resize: none;
		font: inherit;
		padding: 8px 10px;
		border: 1px solid var(--line);
		border-radius: 8px;
	}

	textarea:focus {
		outline: 2px solid var(--accent);
		outline-offset: -1px;
	}

	.send {
		align-self: flex-end;
		background: var(--accent);
		color: #fff;
		border: 0;
		border-radius: 8px;
		padding: 9px 16px;
		font-weight: 600;
	}

	.send:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.error {
		white-space: pre-line;
		background: #fdecec;
		border: 1px solid #f3c9c9;
		color: #8c2020;
		padding: 8px 10px;
		border-radius: 7px;
		font-size: 13px;
	}
</style>
