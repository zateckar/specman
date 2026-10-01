<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import {
		SPOKEN_LANGUAGES,
		defaultSpokenLanguage,
		describeDictationError,
		joinDictation,
		spokenText,
		type HeardSegment
	} from '$lib/dictation';

	/**
	 * Speaking an answer instead of typing it, through the browser's own speech
	 * recognition. Nothing is sent to Specman until the user presses Send: what was
	 * heard lands in the answer box, where they can read and correct it first.
	 *
	 * On-device recognition is used whenever the browser offers it, downloading the
	 * language on first use. Otherwise the browser uses its maker's online service,
	 * and the status line says so while it listens — that is a recording leaving
	 * the company, and the user is the one to decide whether that is acceptable.
	 */

	interface RecognitionResultList {
		length: number;
		[index: number]: { isFinal: boolean; [alt: number]: { transcript: string } };
	}

	interface Recognition {
		lang: string;
		continuous: boolean;
		interimResults: boolean;
		processLocally?: boolean;
		onresult: ((event: { results: RecognitionResultList }) => void) | null;
		onerror: ((event: { error: string }) => void) | null;
		onend: (() => void) | null;
		start(): void;
		stop(): void;
		abort(): void;
	}

	interface RecognitionConstructor {
		new (): Recognition;
		available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string>;
		install?: (options: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
	}

	let {
		value = $bindable(''),
		listening = $bindable(false),
		status = $bindable(''),
		disabled = false
	}: {
		/** The answer being written. */
		value?: string;
		listening?: boolean;
		/** A line for the user: where speech is transcribed, or why it failed. */
		status?: string;
		disabled?: boolean;
	} = $props();

	const STORAGE_KEY = 'specman.spokenLanguage';

	// Found on mount, not during server rendering: the button exists only where the
	// browser can actually transcribe, so no one is offered a control that fails.
	let Engine = $state<RecognitionConstructor | null>(null);
	let lang = $state<string>(SPOKEN_LANGUAGES[0].tag);
	let preparing = $state(false);
	let recognition: Recognition | null = null;
	let destroyed = false;

	const languageLabel = $derived(SPOKEN_LANGUAGES.find((l) => l.tag === lang)?.label ?? lang);

	onMount(() => {
		const scope = window as unknown as Record<string, RecognitionConstructor | undefined>;
		Engine = scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;

		const saved = localStorage.getItem(STORAGE_KEY);
		lang = SPOKEN_LANGUAGES.some((l) => l.tag === saved)
			? (saved as string)
			: defaultSpokenLanguage(navigator.languages ?? [navigator.language]);

		return () => {
			destroyed = true;
			cancel();
		};
	});

	// A turn started (or the pane went away): stop writing into the box.
	$effect(() => {
		if (disabled && (listening || preparing)) untrack(cancel);
	});

	function chooseLanguage(tag: string) {
		lang = tag;
		localStorage.setItem(STORAGE_KEY, tag);
	}

	/** Can this browser transcribe the language without sending the audio anywhere? */
	async function onDevice(engine: RecognitionConstructor): Promise<boolean> {
		if (typeof engine.available !== 'function') return false;
		try {
			const state = await engine.available({ langs: [lang], processLocally: true });
			if (state === 'available') return true;
			if ((state === 'downloadable' || state === 'downloading') && typeof engine.install === 'function') {
				status = `Preparing speech recognition for ${languageLabel} on this computer…`;
				return await engine.install({ langs: [lang], processLocally: true });
			}
		} catch {
			// An engine that cannot answer the question is treated as having no local model.
		}
		return false;
	}

	async function start() {
		const engine = Engine;
		if (!engine || disabled || listening || preparing) return;

		preparing = true;
		status = '';
		const local = await onDevice(engine);
		preparing = false;
		if (destroyed || disabled) return;

		const typed = value;
		const r = new engine();
		r.lang = lang;
		r.continuous = true;
		r.interimResults = true;
		if (local) r.processLocally = true;

		r.onresult = (event) => {
			const heard: HeardSegment[] = [];
			for (let i = 0; i < event.results.length; i++) {
				heard.push({ transcript: event.results[i][0].transcript, isFinal: event.results[i].isFinal });
			}
			value = joinDictation(typed, spokenText(heard));
		};
		r.onerror = (event) => {
			const message = describeDictationError(event.error);
			if (message) status = message;
		};
		r.onend = () => {
			if (recognition !== r) return;
			recognition = null;
			listening = false;
			// Keep an error on screen; the "listening" line no longer applies.
			if (status.startsWith('Listening')) status = '';
		};

		recognition = r;
		try {
			r.start();
		} catch {
			recognition = null;
			status = describeDictationError('');
			return;
		}
		listening = true;
		status = local
			? `Listening in ${languageLabel} — transcribed on this computer.`
			: `Listening in ${languageLabel} — your browser sends the recording to its online speech service to transcribe it.`;
	}

	/** Stop listening and keep what was heard. */
	function stop() {
		recognition?.stop();
	}

	/**
	 * Stop at once and accept nothing more. Used when the answer is being sent, so
	 * a late result cannot refill the box after it has been cleared.
	 */
	export function cancel() {
		const r = recognition;
		recognition = null;
		if (r) {
			r.onresult = null;
			r.onerror = null;
			r.onend = null;
			r.abort();
		}
		listening = false;
		preparing = false;
		if (status.startsWith('Listening') || status.startsWith('Preparing')) status = '';
	}
</script>

{#if Engine}
	<div class="dictation">
		<button
			class="mic"
			class:on={listening}
			type="button"
			onclick={() => (listening ? stop() : start())}
			disabled={disabled || preparing}
			aria-pressed={listening}
			aria-label={listening ? 'Stop listening' : `Speak your answer (${languageLabel})`}
			title={listening ? 'Stop listening' : `Speak your answer (${languageLabel})`}
		>
			<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
				<rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
				<path d="M6 11a6 6 0 0 0 12 0M12 17v4M8.5 21h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
			</svg>
		</button>
		<select
			aria-label="Language you speak in"
			value={lang}
			onchange={(event) => chooseLanguage(event.currentTarget.value)}
			disabled={listening || preparing}
		>
			{#each SPOKEN_LANGUAGES as language}
				<option value={language.tag}>{language.label}</option>
			{/each}
		</select>
	</div>
{/if}

<style>
	.dictation {
		align-self: flex-end;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
	}

	.mic {
		display: grid;
		place-items: center;
		width: 38px;
		height: 36px;
		background: var(--bg);
		color: var(--ink-soft);
		border: 1px solid var(--line);
		border-radius: 8px;
	}

	.mic:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
	}

	.mic.on {
		background: #fdecec;
		border-color: #d04545;
		color: #b02a2a;
		animation: pulse 1.4s ease-in-out infinite;
	}

	.mic:disabled {
		opacity: 0.45;
		cursor: default;
	}

	select {
		font: inherit;
		font-size: 10.5px;
		color: var(--ink-soft);
		background: transparent;
		border: 0;
		padding: 0;
		max-width: 64px;
	}

	@keyframes pulse {
		50% {
			box-shadow: 0 0 0 4px rgba(208, 69, 69, 0.18);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.mic.on {
			animation: none;
		}
	}
</style>
