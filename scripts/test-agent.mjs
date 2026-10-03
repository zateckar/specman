/**
 * Regression tests for the turn-reconciliation invariant: a chapter is complete
 * exactly when nothing is left to ask.
 *
 * Breaking this produced a real bug — a chapter was marked complete while its
 * question was still on screen, and because the next turn rebuilds the system
 * prompt from stored state, the agent read "finished, nothing open" and started
 * interviewing the user about the next chapter instead. The replies below are
 * taken verbatim from the transcript that produced it.
 *
 * Plain Node, no test runner: `src/lib/server/llm/questions.ts` has no imports,
 * so Node's built-in type stripping loads it directly.
 *
 *   npm test
 */
import {
	namesChapter,
	parseOptions,
	questionsInReply,
	reconcileAssessment
} from '../src/lib/server/llm/questions.ts';
import { nextChapter } from '../src/lib/next-chapter.ts';
import {
	defaultSpokenLanguage,
	describeDictationError,
	joinDictation,
	spokenText
} from '../src/lib/dictation.ts';
import { ChapterStreamParser } from '../src/lib/server/llm/blocks.ts';
import {
	nextRef,
	normaliseScope,
	parseRequirementBody,
	readScenarioLines,
	sameStatement,
	scenarioLines,
	toRequirementDraft
} from '../src/lib/server/llm/requirements.ts';
import { validateDocument } from '../src/lib/server/llm/validation.ts';
import {
	attributeDecision,
	effectiveStatus,
	normaliseSource,
	pendingByChapter,
	toDecisionDraft,
	unconfirmed
} from '../src/lib/server/llm/decisions.ts';
import { requirementDelta, summariseDelta } from '../src/lib/server/llm/delta.ts';
import { mergeIssues, summariseIssues, toIssue } from '../src/lib/server/llm/issues.ts';
import { createSlots, mapWithLimit } from '../src/lib/server/llm/parallel.ts';
import {
	chapterApplies,
	describeProfile,
	readConditions,
	reasonForSkipping,
	toProfile
} from '../src/lib/server/llm/profile.ts';
import { baseSlug, uniqueSlug } from '../src/lib/server/llm/slug.ts';
import { buildSingleFile, buildSpecBundle, bundleSummary } from '../src/lib/server/llm/export.ts';
import {
	arrangeChapters,
	chapterPath,
	claimSectionKeys,
	countableChapters,
	distributeContent,
	parseSectionPlan,
	reconcileSections,
	similarity
} from '../src/lib/server/llm/subchapters.ts';
import { buildModel, layerOf, toElement, toRelation } from '../src/lib/server/llm/architecture.ts';
import { edgePath, layoutDiagram, wrapName } from '../src/lib/server/llm/diagram.ts';
import {
	conceptFor,
	escapeXml,
	relationshipFor,
	toOpenExchange
} from '../src/lib/server/llm/archimate.ts';
import { renderMarkdown, safeUrl } from '../src/lib/safe-markdown.ts';
import { createSink, sseFrame } from '../src/lib/server/llm/sink.ts';
import { attemptAddress, readForwardedIdentity } from '../src/lib/server/llm/forwarded.ts';
import { ending, GEMINI_MAX_OUTPUT_TOKENS, geminiBody, geminiModelPath, geminiRetryable, geminiRoom, readGeminiPayload } from '../src/lib/server/llm/gemini-format.ts';
import { ModelRouting, PRIMARY_REST_MS, failureToReport, mayAskNext, ranOutOfRoom } from '../src/lib/server/llm/fallback.ts';
import * as budgets from '../src/lib/server/llm/budgets.ts';
import { describeUsage, toolInput } from '../src/lib/server/llm/transport.ts';
import { textOf } from '../src/lib/server/llm/types.ts';
import {
	ACTIVE_LIMIT,
	HISTORY_KEEP,
	HISTORY_STEP,
	LONG_CHAPTER,
	READ_TOOL,
	buildTurnState,
	chapterParts,
	documentContext,
	historyWindowStart,
	mergeSection,
	outlineOf,
	readChapter,
	relatedness,
	sameHeading,
	repairRequest,
	unwrittenMentions,
	withLastTurn
} from '../src/lib/server/llm/context.ts';
import { DRAFT_EVERY_MS, TurnProgress } from '../src/lib/server/llm/progress.ts';
import { describeActivity, wordCount } from '../src/lib/activity.ts';
import { safeReturnPath } from '../src/lib/server/llm/return-path.ts';
import { describeFailure } from '../src/lib/server/llm/failures.ts';
import { FREE_ATTEMPTS, SignInAttempts } from '../src/lib/server/llm/attempts.ts';
import { createLocks } from '../src/lib/server/llm/lock.ts';
import { createPresence } from '../src/lib/server/llm/presence.ts';
import { readFrames } from '../src/lib/sse.ts';
import {
	asDraftBlock,
	buildDraftPrompt,
	chaptersToDraft,
	draftedProse,
	draftRequest,
	draftState,
	isUntouchedDraft,
	UNCHECKED_CHAPTER
} from '../src/lib/server/llm/draft.ts';
import {
	betterMockup,
	buildMockupPrompt,
	buildScreensPrompt,
	DOCUMENT_PROSE_LIMIT,
	extractMockup,
	extractScreens,
	forTheFrame,
	loadsFromOutside,
	MOCKUP_FILE_POLICY,
	MOCKUP_POLICY,
	MOCKUP_SANDBOX,
	mockupDocument,
	mockupFileName,
	mockupHeaders,
	mockupRequest,
	prepareMockup,
	PROSE_LIMIT,
	RULES_PER_CHAPTER,
	SCREENS_LIMIT,
	screensRequest,
	worthAnotherTry
} from '../src/lib/server/llm/mockup.ts';
import { longCalls } from '../src/lib/server/llm/parallel.ts';
import {
	BASELINE,
	buildOverviewPrompt,
	buildReport,
	byHand,
	CATALOGUE,
	DAY_RATE,
	extractOverview,
	MAX_PART_DAYS,
	overviewRequest,
	readOverview,
	renderReport,
	REPORT_POLICY,
	reportFileName,
	reportHeaders,
	running as runningCosts,
	settleOverview,
	shareOfWork,
	toBlocks,
	withAi
} from '../src/lib/server/llm/overview.ts';

let pass = 0;
let fail = 0;

function check(name, got, want) {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	ok ? pass++ : fail++;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
	if (!ok) {
		console.log('   got  ', JSON.stringify(got, null, 2));
		console.log('   want ', JSON.stringify(want, null, 2));
	}
}

/* --- replies taken from the transcript that produced the bug --------------- */

const askedInProse =
	"That gives me a clear picture of the three groups. One thing I'd like to pin down: can an employee cancel or change their own booking in the app, or does any change to a booking always have to go through the fleet office?";

const askedAfterAbbreviation =
	"That's clear and gives me almost everything for the overview. One quick question so I can anchor it: which team or person is actually asking for this — the fleet office itself, or someone else (e.g. HR or facility management)?";

const askedAsList = `That's a clear picture of the core flow. A few things around the edges of a booking:

1. How should the confirmation reach the employee — an email, or is a message inside the application enough?
2. Should anything happen automatically, without someone asking — for example a reminder the day before the trip, or releasing a booked car if nobody collects it by a certain time?
3. If the fleet office needs to block a car that someone has already booked, what should happen to that existing booking?`;

const askedNothing = 'That is recorded. The chapter now covers all three groups.';

console.log('--- extracting the questions the agent asked ---');

check('lead-in sentence dropped, question kept', questionsInReply(askedInProse), [
	"One thing I'd like to pin down: can an employee cancel or change their own booking in the app, or does any change to a booking always have to go through the fleet office?"
]);

check('"e.g." does not split the question', questionsInReply(askedAfterAbbreviation), [
	'One quick question so I can anchor it: which team or person is actually asking for this — the fleet office itself, or someone else (e.g. HR or facility management)?'
]);

check('numbered list yields one entry per question', questionsInReply(askedAsList).length, 3);
check(
	'list marker stripped',
	questionsInReply(askedAsList)[0],
	'How should the confirmation reach the employee — an email, or is a message inside the application enough?'
);
check(
	'non-question lead-in line ignored',
	questionsInReply(askedAsList).some((q) => q.includes('core flow')),
	false
);
check('a reply asking nothing yields nothing', questionsInReply(askedNothing), []);

// The agent writes in the user's language, so extraction must not assume English.
check('czech: two-letter word is not an abbreviation', questionsInReply('Rozumím, zapsal jsem to. Kdo bude vozy spravovat?'), [
	'Kdo bude vozy spravovat?'
]);
check('german: "z. B." is an abbreviation', questionsInReply('Alles klar. Wer verwaltet die Fahrzeuge, z. B. die Flottenstelle?'), [
	'Wer verwaltet die Fahrzeuge, z. B. die Flottenstelle?'
]);

console.log('\n--- reconciling the assessor against the reply ---');

check(
	'THE BUG: assessor says complete while a question hangs',
	reconcileAssessment({ status: 'complete', openQuestions: [] }, askedInProse),
	{
		status: 'in_progress',
		openQuestions: [
			"One thing I'd like to pin down: can an employee cancel or change their own booking in the app, or does any change to a booking always have to go through the fleet office?"
		]
	}
);

check(
	"assessor's own wording wins when it supplies questions",
	reconcileAssessment(
		{ status: 'complete', openQuestions: ['Can an employee cancel their own booking?'] },
		askedInProse
	),
	{ status: 'in_progress', openQuestions: ['Can an employee cancel their own booking?'] }
);

check('a genuinely finished chapter still completes', reconcileAssessment({ status: 'complete', openQuestions: [] }, askedNothing), {
	status: 'complete',
	openQuestions: []
});

check(
	'in_progress is left alone',
	reconcileAssessment({ status: 'in_progress', openQuestions: ['Who owns the cars?'] }, 'Some prose.'),
	{ status: 'in_progress', openQuestions: ['Who owns the cars?'] }
);

check(
	'assessment call failed, question asked — still recorded',
	reconcileAssessment(null, 'Understood. Who approves a booking?'),
	{ status: 'in_progress', openQuestions: ['Who approves a booking?'] }
);

check('assessment call failed, nothing asked — no state change', reconcileAssessment(null, 'All done.'), null);

console.log('\n--- an invitation to move on is not an open question ---');

const others = ['Overview', 'Users and roles', 'What the application does', 'Security'];
const movedOn = 'That covers everything this chapter needs. Shall we look at Users and roles next?';

check(
	'THE BUG: assessor filed the invitation and kept the chapter open',
	reconcileAssessment(
		{ status: 'in_progress', openQuestions: ['Shall we look at Users and roles next?'] },
		movedOn,
		others
	),
	{ status: 'complete', openQuestions: [] }
);

check(
	'assessor says complete, reply only invites — the question is not extracted',
	reconcileAssessment({ status: 'complete', openQuestions: [] }, movedOn, others),
	{ status: 'complete', openQuestions: [] }
);

check(
	'a real question beside the invitation still keeps the chapter open',
	reconcileAssessment(
		{ status: 'complete', openQuestions: [] },
		'Nearly there. Who approves a booking? After that, shall we look at Security?',
		others
	),
	{ status: 'in_progress', openQuestions: ['Who approves a booking?'] }
);

check(
	'the concept in lower case is a real question, not a chapter name',
	reconcileAssessment(
		{ status: 'complete', openQuestions: ['Which users and roles can see a booking?'] },
		'',
		others
	),
	{ status: 'in_progress', openQuestions: ['Which users and roles can see a booking?'] }
);

check(
	'unmet criteria with no questions stay in progress',
	reconcileAssessment({ status: 'in_progress', openQuestions: [] }, movedOn, others),
	{ status: 'in_progress', openQuestions: [] }
);

check('a title inside a longer word is not a match', namesChapter('Is it Overviewed?', others), false);
check('a title across a line break still matches', namesChapter('Open What the\napplication does?', others), true);

console.log('\n--- the chapter offered next ---');

const index = [
	{ key: 'overview', title: 'Overview', status: 'complete' },
	{ key: 'users', title: 'Users and roles', status: 'complete' },
	{ key: 'features', title: 'What the application does', status: 'in_progress' },
	{ key: 'booking', title: 'Booking a car', status: 'empty', parent_key: 'features' },
	{ key: 'blocking', title: 'Blocking a car', status: 'complete', parent_key: 'features' },
	{ key: 'telemetry', title: 'Telemetry', status: 'empty', applicable: false },
	{ key: 'security', title: 'Security', status: 'in_progress' }
];

check('skips finished chapters and the split container', nextChapter(index, 'users')?.key, 'booking');
check('skips a chapter set aside', nextChapter(index, 'booking')?.key, 'security');
check('wraps round to the start', nextChapter(index, 'security')?.key, 'booking');
check('from the whole document, the first unfinished one', nextChapter(index, null)?.key, 'booking');
check(
	'nothing left — none offered',
	nextChapter(index.map((c) => ({ ...c, status: 'complete' })), 'overview'),
	null
);

console.log('\n--- speaking an answer ---');

check(
	'final and provisional segments read as one answer',
	spokenText([
		{ transcript: 'The fleet office', isFinal: true },
		{ transcript: ' approves  every booking', isFinal: false }
	]),
	'The fleet office approves every booking'
);
check('nothing heard yet', spokenText([]), '');
check('speech follows what was typed', joinDictation('Mostly email.', 'Sometimes Teams'), 'Mostly email. Sometimes Teams');
check('no doubled space after a trailing one', joinDictation('Mostly email. ', 'Teams'), 'Mostly email. Teams');
check('an empty box takes the speech as it is', joinDictation('  ', 'Teams'), 'Teams');
check('silence leaves the typed text alone', joinDictation('Mostly email.', ''), 'Mostly email.');
check('a Czech browser starts in Czech', defaultSpokenLanguage(['cs', 'en-US']), 'cs-CZ');
check('a British browser starts in English', defaultSpokenLanguage(['en-GB']), 'en-US');
check('an unknown language falls back to the first offered', defaultSpokenLanguage(['ja-JP']), 'cs-CZ');
check('silence is not an error', describeDictationError('no-speech'), '');
check('a blocked microphone says how to fix it', describeDictationError('not-allowed').includes('Allow it'), true);

console.log('\n--- answers offered alongside a question ---');

check(
	'a well-formed block',
	parseOptions('Email only [recommended]\nA message inside the application\nBoth'),
	[
		{ label: 'Email only', recommended: true },
		{ label: 'A message inside the application', recommended: false },
		{ label: 'Both', recommended: false }
	]
);

check('list markers stripped', parseOptions('- Yes [recommended]\n- No').length, 2);
check(
	'no marker: the first option is the recommendation',
	parseOptions('Yes\nNo').map((o) => o.recommended),
	[true, false]
);
check(
	'two marked: only the first survives, so advice is unambiguous',
	parseOptions('Yes [recommended]\nNo [recommended]').map((o) => o.recommended),
	[true, false]
);
check('capped at four', parseOptions('a1\nb2\nc3\nd4\ne5\nf6').length, 4);
check('duplicates dropped', parseOptions('Yes\nyes\nNo').length, 2);
check('a lone option is not a choice', parseOptions('Yes [recommended]'), []);
check('an empty block offers nothing', parseOptions(''), []);
check('prose is not an option', parseOptions('Yes\n' + 'x'.repeat(130)).length, 0);

console.log('\n--- keeping blocks out of the chat pane ---');

function streamed(chunks) {
	const parser = new ChapterStreamParser();
	let visible = '';
	for (const c of chunks) visible += parser.push(c);
	visible += parser.end();
	return { visible: visible.trim(), parser };
}

const whole = streamed([
	'Good, that helps.\n<chapter key="security">Access is limited.</chapter>\nAnything else?\n',
	'<options>\nYes [recommended]\nNo\n</options>'
]);
check('chapter markdown never reaches the user', whole.visible.includes('Access is limited'), false);
check('options never reach the user', whole.visible.includes('[recommended]'), false);
check('the conversational text survives', whole.visible, 'Good, that helps.\n\nAnything else?');
check('the chapter is captured', whole.parser.drafts.get('security'), 'Access is limited.');
check('the options are captured', parseOptions(whole.parser.optionsBlock).length, 2);

// The gateway streams a few characters at a time, so every tag gets split.
const split = streamed('Hi.\n<chapter key="data">Body text.</chapter>\n<options>\nA\nB\n</options>'.split(''));
check('tags split across chunks still parse', split.parser.drafts.get('data'), 'Body text.');
check('options split across chunks still parse', parseOptions(split.parser.optionsBlock).length, 2);
check('nothing leaks when split character by character', split.visible, 'Hi.');

// The stream ending inside a block. The gateway refuses a reply that ran out of
// max_tokens, so this is the model stopping cleanly without closing its block.
const cut = streamed(['Here it is.\n<chapter key="data">Half a sen']);
check('an unterminated chapter is salvaged', cut.parser.drafts.get('data'), 'Half a sen');
check('and its text still does not leak', cut.visible, 'Here it is.');

// Nobody means to erase a chapter by writing nothing into it.
check('an empty chapter block is not a draft', streamed(['<chapter key="security"></chapter>Thanks!']).parser.drafts.has('security'), false);
check('nor is a self-closed one', streamed(['<chapter key="security"/>Thanks!']).parser.drafts.has('security'), false);
check('nor one holding only whitespace', streamed(['<chapter key="security">\n  \n</chapter>']).parser.drafts.size, 0);

// The model finished but forgot to close the chapter. Blocks never nest, so the
// next opening tag is where it ended — and what follows is not chapter prose.
const forgot = streamed([
	'<chapter key="security">## Access\nOnly staff.\n',
	'<requirement scope="now">Users must sign in\nWHEN x\nTHEN y</requirement>\n',
	'Which team owns this?'
]);
check('an unclosed chapter ends where the next block opens', forgot.parser.drafts.get('security'), '## Access\nOnly staff.');
check('the requirement after it is still recorded', forgot.parser.blocksOf('requirement').length, 1);
check('and the reply after that still reaches the user', forgot.visible, 'Which team owns this?');
check('no developer notation lands in the prose', forgot.parser.drafts.get('security').includes('WHEN'), false);

check('single-quoted attributes are read', streamed(["<chapter key='data'>Body.</chapter>"]).parser.drafts.get('data'), 'Body.');
check('and do not leak the tag', streamed(["Hi.\n<chapter key='data'>Body.</chapter>"]).visible, 'Hi.');
// No key means the chapter under discussion; the caller knows which that is.
check('a chapter block with no key is kept for the caller', streamed(['<chapter>Body.</chapter>']).parser.drafts.get(''), 'Body.');

console.log('\n--- requirements ---');

const body = `The application must never allow two people to book the same car on the same day.
WHEN two employees try to reserve the same car for the same day
THEN only the first succeeds, and the second is told the car is taken`;

check('statement and scenario split', parseRequirementBody(body), {
	statement: 'The application must never allow two people to book the same car on the same day.',
	scenarios: [
		{
			when: 'two employees try to reserve the same car for the same day',
			then: 'only the first succeeds, and the second is told the car is taken'
		}
	]
});

check(
	'decorated markers are tolerated',
	parseRequirementBody('It must lock.\n- **WHEN** a car is blocked\n- **THEN** nobody may book it')
		.scenarios,
	[{ when: 'a car is blocked', then: 'nobody may book it' }]
);

check(
	'several scenarios under one requirement',
	parseRequirementBody('R.\nWHEN a\nTHEN b\nWHEN c\nTHEN d').scenarios.length,
	2
);

check(
	'continuation lines attach to the right half',
	parseRequirementBody('R.\nWHEN a happens\nand b happens\nTHEN c').scenarios[0].when,
	'a happens and b happens'
);

check(
	'bold closing after the colon is tolerated',
	parseRequirementBody('R.\n- **WHEN:** a car is blocked\n- **THEN:** nobody may book it').scenarios,
	[{ when: 'a car is blocked', then: 'nobody may book it' }]
);

// Without a word boundary on the marker, "WHENEVER" would be read as "WHEN".
check(
	'a word merely starting with WHEN is not a marker',
	parseRequirementBody('R.\nWHENEVER this happens it is fine.').scenarios,
	[]
);

// Losing the agent's wording because it mangled the markers would be worse than
// keeping an unverifiable requirement; validation flags it instead.
check('a body with no scenario still yields the statement', parseRequirementBody('Just a rule.'), {
	statement: 'Just a rule.',
	scenarios: []
});

check('scope defaults to now', normaliseScope(undefined), 'now');
check('scope synonyms', [normaliseScope('v2'), normaliseScope('out-of-scope')], ['later', 'out']);

check('refs are sequential per project', nextRef(['REQ-001', 'REQ-004', 'REQ-002']), 'REQ-005');
check('first ref', nextRef([]), 'REQ-001');
check('unparseable refs are ignored', nextRef(['nonsense', 'REQ-009']), 'REQ-010');

check(
	'a new requirement carries no ref — the server assigns it',
	toRequirementDraft({ scope: 'later' }, body)?.ref,
	null
);
check(
	'removal needs only a ref',
	toRequirementDraft({ ref: 'REQ-004', action: 'remove' }, ''),
	{
		ref: 'REQ-004',
		chapterKey: null,
		scope: 'now',
		statement: '',
		scenarios: [],
		remove: true,
		existing: false
	}
);
check('removal without a ref is refused', toRequirementDraft({ action: 'remove' }, ''), null);
check('an empty block is not a requirement', toRequirementDraft({}, '   '), null);

console.log('\n--- document validation ---');

const chapter = { key: 'sec', title: 'Security', status: 'in_progress', open_questions: [] };
const req = (over) => ({
	ref: 'REQ-001',
	chapter_key: 'sec',
	statement: 'It must lock.',
	scope: 'now',
	scenarios: [{ when: 'a', then: 'b' }],
	...over
});

check('a well-formed document has nothing to say', validateDocument({ chapters: [chapter], requirements: [req()] }), []);

check(
	'a requirement with no example is flagged',
	validateDocument({ chapters: [chapter], requirements: [req({ scenarios: [] })] })[0]?.severity,
	'warning'
);

check(
	'an exclusion needs no example',
	validateDocument({
		chapters: [chapter],
		requirements: [req({ scope: 'out', scenarios: [] })]
	}).filter((f) => f.ref),
	[]
);

check(
	'a document with nothing scheduled to build says so',
	validateDocument({
		chapters: [chapter],
		requirements: [req({ scope: 'out', scenarios: [] })]
	}).some((f) => f.message.includes('Nothing is scheduled')),
	true
);

check(
	'duplicate refs are an error',
	validateDocument({ chapters: [chapter], requirements: [req(), req()] })[0]?.severity,
	'error'
);

check(
	'a requirement on a deleted chapter is an error',
	validateDocument({ chapters: [], requirements: [req()] }).some((f) => f.severity === 'error'),
	true
);

check(
	'finished with questions open is an error',
	validateDocument({
		chapters: [{ ...chapter, status: 'complete', open_questions: ['who?'] }],
		requirements: [req()]
	})[0]?.severity,
	'error'
);

check(
	'errors sort before warnings',
	validateDocument({
		chapters: [chapter],
		requirements: [req({ scenarios: [] }), req({ ref: 'REQ-002', scenarios: [] }), req()]
	})[0]?.severity,
	'error'
);

// Seen in the running instance: one rule in three chapters read "is recorded
// twice", and said it twice.
const thrice = validateDocument({
	chapters: [chapter, { ...chapter, key: 'b' }, { ...chapter, key: 'c' }],
	requirements: [req(), req({ ref: 'REQ-002', chapter_key: 'b' }), req({ ref: 'REQ-003', chapter_key: 'c' })]
}).filter((f) => f.message.includes('is recorded'));
check('a rule held three times is said once, with the count', thrice.map((f) => f.message), ['The rule “It must lock.” is recorded 3 times.']);
check(
	'and a pair still reads "twice"',
	validateDocument({ chapters: [chapter], requirements: [req(), req({ ref: 'REQ-002' })] }).map((f) => f.message),
	['The rule “It must lock.” is recorded twice.']
);

// The badge beside the chapter reads "in progress" while an assumption waits,
// so a finding calling it finished contradicted the same screen.
const waiting = validateDocument({
	chapters: [{ ...chapter, status: 'complete', open_questions: ['who?'] }],
	requirements: [],
	decisions: [{ chapter_key: 'sec', source: 'agent', status: 'proposed' }]
});
check('a chapter waiting on a confirmation is not called finished', waiting.some((f) => /finished/.test(f.message)), false);
check('and the confirmation it waits on is still raised', waiting.some((f) => f.message.includes('made for you')), true);

console.log('\n--- examples written in plain words ---');

check(
	'an example reads back as when and then',
	readScenarioLines('If a colleague signs in, then the company account is used.'),
	{ scenarios: [{ when: 'a colleague signs in', then: 'the company account is used' }] }
);
check(
	'bullets, a missing comma and a missing full stop are tolerated',
	readScenarioLines('- if two people book then one is told\n\n'),
	{ scenarios: [{ when: 'two people book', then: 'one is told' }] }
);
check(
	'the first "then" divides the line',
	readScenarioLines('If they leave, then come back, then the draft is kept.').scenarios[0].when,
	'they leave'
);
check(
	'a line that is not an example is returned, not dropped',
	readScenarioLines('If a, then b.\nWHEN x THEN y'),
	{ unreadable: ['WHEN x THEN y'] }
);
check(
	'what is shown is what is read back',
	readScenarioLines(scenarioLines([{ when: 'a request arrives', then: 'it is answered.' }])),
	{ scenarios: [{ when: 'a request arrives', then: 'it is answered' }] }
);

console.log('\n--- requirement blocks in the stream ---');

const withReq = streamed([
	'Noted.\n<requirement chapter="functionality" scope="now">\nNo double booking.\nWHEN two people book\nTHEN one fails\n</requirement>\nAnything else?'
]);
check('requirement text never reaches the user', withReq.visible, 'Noted.\n\nAnything else?');
check('the block is captured with attributes', withReq.parser.blocksOf('requirement')[0].attrs, {
	chapter: 'functionality',
	scope: 'now'
});

// The opening tag is longer than any fixed hold-back window would allow.
const longTag = streamed(
	'Hi.\n<requirement chapter="data-classification" scope="later" ref="REQ-012">\nRule.\nWHEN a\nTHEN b\n</requirement>'.split(
		''
	)
);
check('a long opening tag does not leak', longTag.visible, 'Hi.');
check('and still parses', longTag.parser.blocksOf('requirement')[0].attrs.ref, 'REQ-012');

// A stray "<" in ordinary prose must not stall the stream.
const angle = streamed(['We need < 5 seconds response.']);
check('a stray angle bracket still streams', angle.visible, 'We need < 5 seconds response.');

// Several blocks in one reply left a visible hole where they were removed.
const many = streamed([
	'Settled.\n',
	'<requirement scope="now">\nA.\nWHEN x\nTHEN y\n</requirement>\n',
	'<requirement scope="now">\nB.\nWHEN x\nTHEN y\n</requirement>\n',
	'<requirement scope="out">\nC.\nWHEN x\nTHEN y\n</requirement>\n',
	'\nThat chapter is done.'
]);
check('stripped blocks leave no gap', many.visible, 'Settled.\n\nThat chapter is done.');
check('all three are still captured', many.parser.blocksOf('requirement').length, 3);
check(
	'blank lines within prose are preserved',
	streamed(['One.\n\nTwo.']).visible,
	'One.\n\nTwo.'
);

console.log('\n--- decisions and who made them ---');

check(
	'statement and reason split',
	toDecisionDraft(
		{ source: 'agent' },
		'Sign-in uses the normal company account.\nWhy: everyone already has one.'
	),
	{
		chapterKey: null,
		statement: 'Sign-in uses the normal company account.',
		rationale: 'everyone already has one.',
		source: 'agent'
	}
);

check(
	'a decision the user made is marked as theirs',
	toDecisionDraft({ source: 'user' }, 'Bookings are cancelled the day before.\nWhy: they said so.')
		?.source,
	'user'
);

// Mislabelling an assistant default as the user's own choice would hide a
// machine's judgement inside their specification; the reverse just asks them to
// confirm something they already said. So anything unclear defaults to 'agent'.
check('a missing source is treated as the assistant', normaliseSource(undefined), 'agent');
check('an unrecognised source is treated as the assistant', normaliseSource('the system'), 'agent');
check('only an explicit user source counts as the user', normaliseSource('USER'), 'user');

check('a decision with no wording is refused', toDecisionDraft({}, 'Why: because.'), null);
check(
	'decorated Why markers are tolerated',
	toDecisionDraft({}, 'We use company sign-in.\n- **Why:** no extra password.')?.rationale,
	'no extra password.'
);

check(
	'unconfirmed skips the user and the already-confirmed',
	unconfirmed([
		{ source: 'user', status: 'confirmed' },
		{ source: 'agent', status: 'confirmed' },
		{ source: 'agent', status: 'proposed' },
		{ source: 'standard', status: 'proposed' }
	]).length,
	2
);

check(
	'unconfirmed assumptions are surfaced',
	validateDocument({
		chapters: [{ ...chapter, status: 'complete' }],
		requirements: [req()],
		decisions: [{ chapter_key: 'sec', source: 'agent', status: 'proposed' }]
	})[0]?.message.includes('made for you'),
	true
);

check(
	'a confirmed assumption says nothing',
	validateDocument({
		chapters: [{ ...chapter, status: 'complete' }],
		requirements: [req()],
		decisions: [{ chapter_key: 'sec', source: 'agent', status: 'confirmed' }]
	}),
	[]
);

// Derived, not stored: writing the downgrade to the database would leave it
// stale the moment the user confirms.
check('a chapter with assumptions outstanding is not complete', effectiveStatus('complete', 2), 'in_progress');
check('confirming the last one restores it at once', effectiveStatus('complete', 0), 'complete');
check('an unfinished chapter is unaffected', effectiveStatus('in_progress', 3), 'in_progress');
check(
	'pending decisions are counted per chapter',
	[
		...pendingByChapter([
			{ chapter_key: 'a', source: 'agent', status: 'proposed' },
			{ chapter_key: 'a', source: 'agent', status: 'proposed' },
			{ chapter_key: 'a', source: 'user', status: 'confirmed' },
			{ chapter_key: 'b', source: 'standard', status: 'proposed' }
		])
	],
	[
		['a', 2],
		['b', 1]
	]
);

console.log('\n--- reviewing a change as rules, not lines ---');

const base = [
	{ ref: 'REQ-001', chapter: 'f', scope: 'now', statement: 'A', scenarios: [{ when: 'x', then: 'y' }] },
	{ ref: 'REQ-002', chapter: 'f', scope: 'now', statement: 'B', scenarios: [] },
	{ ref: 'REQ-003', chapter: 'f', scope: 'now', statement: 'C', scenarios: [] }
];

const next = [
	base[0],
	{ ...base[1], scope: 'later' },
	{ ref: 'REQ-004', chapter: 'f', scope: 'now', statement: 'D', scenarios: [] }
];

const delta = requirementDelta(base, next);

check('untouched requirements are not reported', delta.some((c) => c.ref === 'REQ-001'), false);
check('a postponement is a change of scope, not of wording', delta.find((c) => c.ref === 'REQ-002')?.fields, ['scope']);
check('a dropped requirement is reported', delta.find((c) => c.ref === 'REQ-003')?.kind, 'removed');
check('a new requirement is reported', delta.find((c) => c.ref === 'REQ-004')?.kind, 'added');
check('removals come first', delta[0].kind, 'removed');
check('summary reads in plain language', summariseDelta(delta), '3 requirements: 1 added, 1 changed, 1 removed');
check('no changes says so', summariseDelta([]), 'No changes to what must be true');

check(
	'a reworded scenario counts as a change',
	requirementDelta(
		[base[0]],
		[{ ...base[0], scenarios: [{ when: 'x', then: 'z' }] }]
	)[0]?.fields,
	['scenarios']
);

check(
	'a rule moved to another chapter counts as a change',
	requirementDelta([base[0]], [{ ...base[0], chapter: 'g' }])[0]?.fields,
	['chapter']
);

// A repository whose first proposal has not merged yet has no manifest on main.
check('everything is new when there is no baseline', requirementDelta([], next).length, 3);

console.log('\n--- checking the whole document ---');

check(
	'a finding is read with its references',
	toIssue(
		{ kind: 'contradiction', chapters: 'functionality,security', refs: 'REQ-004,REQ-012' },
		'Two rules disagree about cancelling on the day.'
	),
	{
		kind: 'contradiction',
		chapters: ['functionality', 'security'],
		refs: ['REQ-004', 'REQ-012'],
		message: 'Two rules disagree about cancelling on the day.'
	}
);

check(
	'an unknown kind is not guessed at',
	toIssue({ kind: 'catastrophe' }, 'Something is not right here.')?.kind,
	'unclear'
);
check('the singular attributes are accepted too', toIssue({ chapter: 'sec', ref: 'req-001' }, 'A real problem here.')?.refs, ['REQ-001']);
check('a fragment is not a finding', toIssue({ kind: 'missing' }, 'too short'), null);

// Each chapter is checked separately and the document once more, so the same
// contradiction is usually reported from both sides.
const dupes = [
	{ kind: 'contradiction', chapters: ['a'], refs: ['REQ-001'], message: 'These two rules disagree.' },
	{ kind: 'contradiction', chapters: ['b'], refs: ['REQ-009'], message: 'These two rules disagree!' },
	{ kind: 'unclear', chapters: ['c'], refs: [], message: 'This part is too vague to build.' }
];
const merged = mergeIssues(dupes);
check('the same problem reported twice becomes one', merged.length, 2);
check('and keeps every reference to it', merged[0].chapters, ['a', 'b']);
check('and every requirement it touches', merged[0].refs, ['REQ-001', 'REQ-009']);
check('contradictions are listed first', merged[0].kind, 'contradiction');

check('a clean document says so', summariseIssues([]), 'Nothing to flag — the document holds together.');
check('a summary counts disagreements separately', summariseIssues(merged), '1 thing that disagrees, 1 worth a look');
check(
	'and reads correctly in the plural',
	summariseIssues([...merged, { kind: 'contradiction', chapters: [], refs: [], message: 'Another clash entirely.' }]),
	'2 things that disagree, 1 worth a look'
);

console.log('\n--- running a few calls at a time ---');

// Order of results must follow the input, not the order they happen to finish.
const slow = await mapWithLimit([5, 1, 4, 2, 3], 2, async (n) => {
	await new Promise((r) => setTimeout(r, n));
	return n * 10;
});
check('results keep the order of the input', slow, [50, 10, 40, 20, 30]);

let running = 0;
let peak = 0;
await mapWithLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
	running += 1;
	peak = Math.max(peak, running);
	await new Promise((r) => setTimeout(r, 5));
	running -= 1;
});
check('never more than the limit at once', peak <= 3, true);

check('an empty list does no work', await mapWithLimit([], 3, async () => 1), []);
check(
	'a limit larger than the work is harmless',
	await mapWithLimit([1, 2], 10, async (n) => n),
	[1, 2]
);

{
	// One limit shared by runs that know nothing of each other, as drafts started
	// by different people are.
	const slots = createSlots(2);
	let now = 0;
	let most = 0;
	const order = [];
	const job = (name, ms) => slots.run(async () => {
		now += 1;
		most = Math.max(most, now);
		order.push(name);
		await new Promise((r) => setTimeout(r, ms));
		now -= 1;
		return name;
	});
	const first = [job('a', 10), job('b', 10)];
	const second = [job('c', 1), job('d', 1), job('e', 1)];
	check('the rest wait their turn', [slots.busy, slots.waiting], [2, 3]);
	check('every caller gets its own answer', await Promise.all([...first, ...second]), ['a', 'b', 'c', 'd', 'e']);
	check('never more than the limit across callers', most, 2);
	check('in the order they asked', order, ['a', 'b', 'c', 'd', 'e']);
	check('and nothing is left holding a slot', [slots.busy, slots.waiting], [0, 0]);

	const failing = createSlots(1);
	const broken = failing.run(async () => { throw new Error('gateway down'); });
	const after = failing.run(async () => 'next');
	check('a failure is the caller\'s', await broken.then(() => 'ok', (e) => e.message), 'gateway down');
	check('and still hands its slot on', await after, 'next');

	const held = createSlots(1);
	let release;
	const holder = held.run(() => new Promise((r) => { release = r; }));
	const stop = new AbortController();
	const given = held.run(async () => 'ran', stop.signal);
	const behind = held.run(async () => 'behind');
	stop.abort(new Error('deleted'));
	check('work given up while waiting leaves the queue at once',
		[await given.then(() => 'ran', (e) => e.message), held.waiting], ['deleted', 1]);
	release('held');
	check('and the next in line still gets the slot', [await holder, await behind, held.busy], ['held', 'behind', 0]);
	check('work given up before asking never queues',
		await held.run(async () => 'ran', stop.signal).then(() => 'ran', (e) => e.message), 'deleted');
}

console.log('\n--- which chapters an application needs ---');

const teamTool = toProfile({ reach: 'team', personalData: false, critical: false });
const companyApp = toProfile({ reach: 'company', personalData: true, critical: false });

check('a chapter with no conditions always applies', chapterApplies([], teamTool), true);
check('always means always', chapterApplies(['always'], teamTool), true);
check(
	'data classification is skipped without personal data',
	chapterApplies(['personal_data', 'critical'], teamTool),
	false
);
check(
	'and kept when there is',
	chapterApplies(['personal_data', 'critical'], companyApp),
	true
);
check(
	'any one condition is enough',
	chapterApplies(['personal_data', 'critical'], toProfile({ reach: 'team', personalData: false, critical: true })),
	true
);

// A condition nobody recognises must not quietly delete a chapter.
check('an unknown condition keeps the chapter', chapterApplies(['who_knows'], teamTool), true);

// Unanswered means the cautious answer: a document that asks too much is a
// nuisance; one that skips data classification for personal data is a problem.
check('missing answers assume personal data', toProfile({}).personalData, true);
check('missing answers assume company-wide reach', toProfile({}).reach, 'company');
check('missing answers do not assume criticality', toProfile({}).critical, false);
check('a nonsense reach falls back', toProfile({ reach: 'galaxy' }).reach, 'company');
check('only an explicit no turns personal data off', toProfile({ personalData: false }).personalData, false);

check(
	'the reason is given in the user’s terms',
	reasonForSkipping(['personal_data'], teamTool),
	'Set aside because it holds nothing about identifiable people.'
);
check(
	'two reasons are joined with "and"',
	reasonForSkipping(['personal_data', 'beyond_team'], teamTool),
	'Set aside because it holds nothing about identifiable people and it is used by one team only.'
);
check(
	'three reasons read as a list, not a chain of "and"s',
	reasonForSkipping(['personal_data', 'beyond_team', 'critical'], teamTool),
	'Set aside because it holds nothing about identifiable people, it is used by one team only and it does not touch money, safety, or legally required records.'
);
check(
	'the assistant is told the shape of the application',
	describeProfile(teamTool),
	'used by a single team; holds no personal data; does not touch money, safety, or legally required records'
);

check(
	'a requirement can describe how things already work',
	toRequirementDraft({ existing: 'true' }, 'The old system emails a confirmation.\nWHEN a booking is made\nTHEN an email goes out')
		?.existing,
	true
);
check('and does not by default', toRequirementDraft({}, 'A new rule entirely here.')?.existing, false);

console.log('\n--- the bundle a developer builds from ---');

const exportInput = {
	project: { name: 'Car booking', description: 'Book a pool car', kind: 'new' },
	chapters: [
		{
			key: 'functionality',
			title: 'What it does',
			goal: 'Describe what it does.',
			status: 'complete',
			content_md: 'An employee books a car.',
			position: 2,
			applicable: 1,
			skip_reason: '',
			open_questions: ['Does it need a purpose field?']
		},
		{
			key: 'telemetry',
			title: 'Telemetry',
			goal: 'Know if it works.',
			status: 'empty',
			content_md: '',
			position: 10,
			applicable: 0,
			skip_reason: 'Set aside because it is used by one team only.',
			open_questions: []
		}
	],
	requirements: [
		{
			ref: 'REQ-001',
			chapter_key: 'functionality',
			statement: 'No double booking.',
			scope: 'now',
			scenarios: [{ when: 'two people book', then: 'one fails' }],
			source: 'agent',
			existing: 0
		},
		{
			ref: 'REQ-002',
			chapter_key: 'functionality',
			statement: 'Reminders before the trip.',
			scope: 'later',
			scenarios: [],
			source: 'agent',
			existing: 0
		},
		{
			ref: 'REQ-003',
			chapter_key: 'functionality',
			statement: 'No fuel cards.',
			scope: 'out',
			scenarios: [],
			source: 'user',
			existing: 0
		}
	],
	decisions: [
		{
			chapter_key: 'functionality',
			statement: 'Email confirmations only.',
			rationale: 'nobody reads in-app messages',
			source: 'agent',
			status: 'proposed'
		}
	],
	problems: [{ severity: 'error', message: 'REQ-009 has no wording.' }]
};

const bundle = buildSpecBundle(exportInput);

check(
	'the bundle has an index, a chapter each, decisions and exclusions',
	[...bundle.keys()].sort(),
	['AGENTS.md', 'chapters/020-functionality.md', 'chapters/100-telemetry.md', 'decisions.md', 'out-of-scope.md']
);

const agents = bundle.get('AGENTS.md');
check(
	'the index counts only first-version requirements',
	agents.includes('1 requirement is in scope'),
	true
);
check('structural problems are stated up front', agents.includes('REQ-009 has no wording.'), true);
// The export page showed these to the requester; the builder's index did not.
check(
	'the caveats the requester was shown reach the builder too',
	buildSpecBundle({ ...exportInput, problems: [{ severity: 'warning', message: 'Security states nothing that must be true.' }] })
		.get('AGENTS.md')
		.includes('**1 thing worth checking:**\n\n- Security states nothing that must be true.'),
	true
);
check(
	'the page and the index count from the same place',
	(({ inScope, assumed, openQuestions, errors, warnings }) => [inScope.length, assumed.length, openQuestions, errors.length, warnings.length])(
		bundleSummary(exportInput)
	),
	[1, 1, 1, 1, 0]
);
check('unanswered questions are flagged to the builder', agents.includes('1 question remains unanswered'), true);
check(
	'counts read correctly in the plural too',
	buildSpecBundle({
		...exportInput,
		chapters: [{ ...exportInput.chapters[0], open_questions: ['a?', 'b?'] }, exportInput.chapters[1]],
		requirements: [
			exportInput.requirements[0],
			{ ...exportInput.requirements[0], ref: 'REQ-004' }
		]
	})
		.get('AGENTS.md')
		.includes('2 requirements are in scope') === true &&
		buildSpecBundle({
			...exportInput,
			chapters: [{ ...exportInput.chapters[0], open_questions: ['a?', 'b?'] }, exportInput.chapters[1]]
		})
			.get('AGENTS.md')
			.includes('2 questions remain unanswered'),
	true
);
check('unconfirmed assumptions are flagged', agents.includes('1 decision was made by the assistant'), true);
check('a chapter that does not apply says so in the index', agents.includes('Telemetry](chapters/100-telemetry.md) — not applicable'), true);

const chapterFile = bundle.get('chapters/020-functionality.md');
check('scenarios are kept as acceptance criteria', chapterFile.includes('**WHEN** two people book'), true);
check('postponed work is separated from current work', chapterFile.includes('deliberately not in the first version'), true);
// The exclusion must not sit in the chapter where it could be mistaken for work.
check('excluded requirements are not listed as work', chapterFile.includes('No fuel cards'), false);
check('open questions warn against guessing', chapterFile.includes('Do not guess'), true);

const outOfScope = bundle.get('out-of-scope.md');
check('exclusions are collected', outOfScope.includes('No fuel cards'), true);
check('and so are the areas that do not apply', outOfScope.includes('Telemetry'), true);

const decisionsFile = bundle.get('decisions.md');
check('an unconfirmed assumption is marked as such', decisionsFile.includes('**not confirmed**'), true);
check('and its reason is carried over', decisionsFile.includes('because nobody reads in-app messages'), true);

const single = buildSingleFile(exportInput);
check('the single file starts with the index', single.startsWith('# Car booking'), true);
check('and contains every part', ['What it does', 'Out of scope', '# Decisions'].every((s) => single.includes(s)), true);

// A split chapter's sections are numbered against their parent. Numbering them on
// their own positions put the sections of chapter three among chapters one and
// two — harmless while sections were empty, and wrong the moment they hold the
// functionality, which is where they live now.
const withSections = buildSpecBundle({
	...exportInput,
	chapters: [
		...exportInput.chapters,
		{
			key: 'booking-a-car',
			title: 'Booking a car',
			goal: '',
			status: 'in_progress',
			content_md: 'An employee picks a date.',
			position: 0,
			parent_key: 'functionality',
			applicable: 1,
			skip_reason: '',
			open_questions: []
		},
		{
			key: 'blocking-cars',
			title: 'Blocking a car',
			goal: '',
			status: 'in_progress',
			content_md: 'The fleet office blocks a car.',
			position: 1,
			parent_key: 'functionality',
			applicable: 1,
			skip_reason: '',
			open_questions: []
		}
	]
});

check(
	'a section is numbered under its parent, and follows it',
	[...withSections.keys()].filter((k) => k.startsWith('chapters/')),
	[
		'chapters/020-functionality.md',
		'chapters/020-01-booking-a-car.md',
		'chapters/020-02-blocking-cars.md',
		'chapters/100-telemetry.md'
	]
);
check(
	'and the index lists it in the same order',
	withSections.get('AGENTS.md').indexOf('020-01-booking-a-car') >
		withSections.get('AGENTS.md').indexOf('020-functionality'),
	true
);

// A brownfield export must say what already works, or it gets rebuilt.
const brownfield = buildSpecBundle({
	...exportInput,
	project: { ...exportInput.project, kind: 'change' },
	requirements: [{ ...exportInput.requirements[0], existing: 1 }]
});
check('an existing application is announced', brownfield.get('AGENTS.md').includes('already exists'), true);
check(
	'and current behaviour is marked so it is not rebuilt',
	brownfield.get('chapters/020-functionality.md').includes('already true today'),
	true
);

console.log('\n--- splitting a chapter into sub-chapters ---');

check(
	'a plan is read as identifier and title',
	parseSectionPlan('booking-a-car: Booking a car\nmy-bookings: Seeing my bookings'),
	[
		{ key: 'booking-a-car', title: 'Booking a car' },
		{ key: 'my-bookings', title: 'Seeing my bookings' }
	]
);
check(
	'list markers and numbering are tolerated',
	parseSectionPlan('1. booking: Booking\n- blocking: Blocking').length,
	2
);
check(
	'a title alone still yields a usable identifier',
	parseSectionPlan('Booking a car')[0],
	{ key: 'booking-a-car', title: 'Booking a car' }
);
check('duplicate identifiers collapse', parseSectionPlan('a: One\na: Two').length, 1);
check('an empty plan changes nothing', reconcileSections([], []), []);

const existingSections = [
	{ key: 'booking', title: 'Booking', position: 0, hasContent: true },
	{ key: 'cancel', title: 'Cancelling', position: 1, hasContent: true },
	{ key: 'draft', title: 'Half-baked idea', position: 2, hasContent: false }
];

const ops = reconcileSections(existingSections, [
	{ key: 'booking', title: 'Booking a car' },
	{ key: 'blocking', title: 'Blocking a car' }
]);

check('a reworded title is a rename', ops.some((o) => o.kind === 'rename' && o.key === 'booking'), true);
check('a new section is created in place', ops.find((o) => o.kind === 'create'), {
	kind: 'create',
	key: 'blocking',
	title: 'Blocking a car',
	position: 1
});

// The rule that matters: a model forgetting to mention a section must not delete
// the user's work.
check(
	'an omitted section with content is kept, not removed',
	ops.some((o) => o.kind === 'remove' && o.key === 'cancel'),
	false
);
check(
	'and is moved after the planned ones',
	ops.find((o) => o.kind === 'move' && o.key === 'cancel'),
	{ kind: 'move', key: 'cancel', position: 2 }
);
check(
	'an omitted empty section is removed',
	ops.some((o) => o.kind === 'remove' && o.key === 'draft'),
	true
);
check(
	'nothing happens when the plan already matches',
	reconcileSections(
		[{ key: 'a', title: 'A', position: 0, hasContent: true }],
		[{ key: 'a', title: 'A' }]
	),
	[]
);

console.log('\n--- filing the prose into the sections ---');

// Verbatim from Company car booking, which is where this went wrong: the chapter
// was split when it was almost finished, so the six sub-chapters were created and
// every word stayed in the parent. Opening one showed nothing and called itself
// not started. Two of the six headings were reworded by the agent when it named the
// sections, which is why matching cannot be on exact text.
const grownChapter = `## Booking a car

An employee chooses a date and is shown which pool cars are free that day.

## My bookings and cancellation

A booking can be cancelled up to the day before the reserved date.

## Blocking cars for servicing

The fleet office can block a car for a chosen period.

## One car, one driver per day

It must never be possible for two employees to hold a booking for the same car.

## Automatic behaviour

Confirmation emails go out when a booking is made.

## Deliberately out of scope

Fuel cards and mileage claims are not handled.`;

const sections = [
	{ key: 'booking-a-car', title: 'Booking a car' },
	{ key: 'my-bookings', title: 'Seeing and cancelling my bookings' },
	{ key: 'blocking-cars', title: 'Blocking a car for servicing' },
	{ key: 'one-driver-per-day', title: 'One car, one driver per day' },
	{ key: 'automatic-behaviour', title: 'Automatic behaviour' },
	{ key: 'out-of-scope', title: 'Deliberately out of scope' }
];

const filedAway = distributeContent(grownChapter, sections);

check(
	'every section is filed, in reading order',
	filedAway.filed.map((f) => f.key),
	[
		'booking-a-car',
		'my-bookings',
		'blocking-cars',
		'one-driver-per-day',
		'automatic-behaviour',
		'out-of-scope'
	]
);
check(
	'a reworded heading still finds its section',
	filedAway.filed.find((f) => f.key === 'my-bookings').markdown,
	'A booking can be cancelled up to the day before the reserved date.'
);
check('the heading itself does not travel — the title is the heading now',
	filedAway.filed.every((f) => !f.markdown.startsWith('#')), true);
check('and the parent is left holding nothing', filedAway.parent, '');

// Whichever way it is scored, an exact match must win its own section rather than
// have a loose one take it first.
check(
	'an exact match is not stolen by a loose one',
	distributeContent('## Booking\n\nText.', [
		{ key: 'my-bookings', title: 'Seeing and cancelling my bookings' },
		{ key: 'booking', title: 'Booking' }
	]).filed[0].key,
	'booking'
);

// Nothing is ever lost: what cannot be placed stays where it is, and the parent's
// view shows its sections beneath it so it is still read.
const unmatched = distributeContent(
	'Some words first.\n\n## Booking a car\n\nText.\n\n## Something else entirely\n\nMore text.',
	[{ key: 'booking-a-car', title: 'Booking a car' }]
);
check('a heading with no section stays with the parent', unmatched.parent,
	'Some words first.\n\n## Something else entirely\n\nMore text.');
check('and its neighbour is still filed', unmatched.filed.map((f) => f.key), ['booking-a-car']);

check(
	'a section that already holds something is never written over',
	distributeContent('## Booking a car\n\nNew text.', [
		{ key: 'booking-a-car', title: 'Booking a car', occupied: true }
	]),
	{ parent: '## Booking a car\n\nNew text.', filed: [] }
);
check(
	'a bare heading is not filed — it would leave the section looking unwritten',
	distributeContent('## Booking a car\n\n## Blocking cars\n\nText.', [
		{ key: 'booking-a-car', title: 'Booking a car' },
		{ key: 'blocking-cars', title: 'Blocking cars' }
	]).filed.map((f) => f.key),
	['blocking-cars']
);
check(
	'prose with no headings at all is left alone',
	distributeContent('Just one long paragraph.', sections),
	{ parent: 'Just one long paragraph.', filed: [] }
);

// The level a chapter uses for its sections varies, and a heading inside fenced
// code is not a section.
check(
	'the shallowest heading level is the one that splits',
	distributeContent('# Booking a car\n\nText.\n\n### A detail\n\nMore.', [
		{ key: 'booking-a-car', title: 'Booking a car' }
	]).filed[0].markdown,
	'Text.\n\n### A detail\n\nMore.'
);
check(
	'a heading inside fenced code does not split anything',
	distributeContent('## Booking a car\n\n```\n## not a heading\n```\n\nText.', [
		{ key: 'booking-a-car', title: 'Booking a car' }
	]).filed.length,
	1
);

// The card on the home page and the index inside the project were counting
// differently — "4 of 18" against "3 of 17" for the same document.
check(
	'a split chapter is not counted alongside its own sections',
	countableChapters([
		{ key: 'overview', parent_key: '' },
		{ key: 'functionality', parent_key: '' },
		{ key: 'booking-a-car', parent_key: 'functionality' },
		{ key: 'my-bookings', parent_key: 'functionality' },
		{ key: 'telemetry', parent_key: '', applicable: 0 }
	]).map((c) => c.key),
	['overview', 'booking-a-car', 'my-bookings']
);

check('unrelated titles score below the threshold', similarity('Booking a car', 'Telemetry'), 0);
check('a rewording scores well above it', similarity('Blocking cars for servicing', 'Blocking a car for servicing') > 0.6, true);

console.log('\n--- reading order with sub-chapters ---');

const nested = arrangeChapters([
	{ key: 'security', parent_key: '', position: 7 },
	{ key: 'blocking', parent_key: 'functionality', position: 1 },
	{ key: 'functionality', parent_key: '', position: 2 },
	{ key: 'booking', parent_key: 'functionality', position: 0 },
	{ key: 'overview', parent_key: '', position: 0 }
]);

check(
	'children follow their parent, in their own order',
	nested.map((c) => c.key),
	['overview', 'functionality', 'booking', 'blocking', 'security']
);
check('depth marks the sub-chapters', nested.map((c) => c.depth), [0, 0, 1, 1, 0]);

// A sub-chapter whose parent vanished would otherwise be invisible while still
// sitting in the database.
check(
	'an orphan is still shown',
	arrangeChapters([{ key: 'stray', parent_key: 'gone', position: 0 }]).map((c) => c.key),
	['stray']
);

check(
	'a top-level chapter keeps its flat name',
	chapterPath({ key: 'security', parent_key: '', position: 7 }, 0),
	'docs/070-security.md'
);
check(
	'a sub-chapter sorts under its parent',
	chapterPath({ key: 'booking', parent_key: 'functionality', position: 0 }, 2),
	'docs/020-01-booking.md'
);

console.log('\n--- the layered model ---');

check('an actor belongs to the business layer', layerOf('actor'), 'business');
check('a data object belongs to the application layer', layerOf('data'), 'application');
check('a system belongs to the technology layer', layerOf('system'), 'technology');

check(
	'an element is identified by a slug of its name',
	toElement({ type: 'process', name: 'Booking a car', chapter: 'booking-a-car' }, ''),
	{
		id: 'booking-a-car',
		name: 'Booking a car',
		type: 'process',
		layer: 'business',
		chapter: 'booking-a-car'
	}
);
// A mislabelled box still tells the reader something; a dropped one does not.
check('an unknown type falls back rather than vanishing', toElement({ type: 'wormhole', name: 'Thing' }, '')?.type, 'service');
check('an element with no usable name is refused', toElement({ type: 'actor', name: 'x' }, ''), null);

check('a relation resolves its endpoints by name', toRelation({ from: 'Employee', to: 'Booking a car', kind: 'assigned' }), {
	from: 'employee',
	to: 'booking-a-car',
	kind: 'assigned'
});
check('an unknown kind falls back to serves', toRelation({ from: 'A thing', to: 'B thing', kind: 'wibble' })?.kind, 'serves');
check('a relation to itself is refused', toRelation({ from: 'Employee', to: 'Employee' }), null);

const modelElements = [
	toElement({ type: 'actor', name: 'Employee' }, ''),
	toElement({ type: 'process', name: 'Booking a car' }, ''),
	toElement({ type: 'data', name: 'Booking' }, ''),
	toElement({ type: 'system', name: 'Email' }, '')
];

const model = buildModel(modelElements, [
	toRelation({ from: 'Employee', to: 'Booking a car', kind: 'assigned' }),
	toRelation({ from: 'Booking a car', to: 'Booking', kind: 'accesses' }),
	// Names something never declared: dropping the line beats inventing a box,
	// because a reader cannot tell an invented element from a real one.
	toRelation({ from: 'Booking a car', to: 'Carrier pigeon', kind: 'flow' }),
	toRelation({ from: 'Employee', to: 'Booking a car', kind: 'assigned' })
]);

check('every declared element is kept', model.elements.length, 4);
check('a relation naming something undeclared is dropped', model.relations.length, 2);
check('a repeated relation appears once', model.relations.filter((r) => r.kind === 'assigned').length, 1);

console.log('\n--- laying the diagram out ---');

const laid = layoutDiagram(model);

check('every element gets a box', laid.boxes.length, 4);
check('there are three bands', laid.bands.map((b) => b.layer), ['business', 'application', 'technology']);
check('business sits above application', laid.bands[0].y < laid.bands[1].y, true);
check('and application above technology', laid.bands[1].y < laid.bands[2].y, true);

const businessBand = laid.bands[0];
const employee = laid.boxes.find((b) => b.id === 'employee');
check(
	'a box sits inside its own band',
	employee.y >= businessBand.y && employee.y + employee.height <= businessBand.y + businessBand.height,
	true
);

check('every relation becomes a line', laid.edges.length, 2);
const edge = laid.edges.find((e) => e.from === 'employee');
check('lines have real endpoints', edge.x1 !== edge.x2 || edge.y1 !== edge.y2, true);

// A line must stop at the border, or the arrowhead lands on the label.
const target = laid.boxes.find((b) => b.id === 'booking-a-car');
check(
	'a line ends on the edge of its target, not its centre',
	Math.abs(edge.y2 - (target.y + target.height / 2)) > 1 ||
		Math.abs(edge.x2 - (target.x + target.width / 2)) > 1,
	true
);

// The same model must always produce the same picture: a diagram that moves
// between views cannot be compared, and a random layout cannot be tested.
check('the layout is deterministic', JSON.stringify(layoutDiagram(model)), JSON.stringify(laid));
check('an empty model still yields bands, not a crash', layoutDiagram({ elements: [], relations: [] }).bands.length, 3);

// The name is wrapped where the geometry is decided, so the box is tall enough
// for it — wrapping in the renderer spilled three-line names out of the bottom.
check('a short name is one line', wrapName('Employee'), ['Employee']);
check(
	'a long name breaks on words',
	wrapName('Seeing and cancelling my bookings'),
	['Seeing and cancelling', 'my bookings']
);
check(
	'an unreasonably long name is marked as shortened, not silently cut',
	wrapName('One extremely long capability name that simply will not fit inside any box').at(-1).endsWith('…'),
	true
);
check(
	'a word longer than a line is broken, not left to run out of the box',
	wrapName('Fahrzeugdisponierungssystemverwaltung').every((line) => line.length <= 22),
	true
);
check(
	'and the break is marked',
	wrapName('Fahrzeugdisponierungssystemverwaltung')[0].endsWith('-'),
	true
);
check(
	'the shortening mark stays inside the line',
	wrapName('Onetwothreefourfivesix onetwothreefourfivesix onetwothreefourfivesix more words here').every(
		(line) => line.length <= 22
	),
	true
);
check(
	'every box is tall enough for its own lines',
	laid.boxes.every((b) => b.height >= 20 + b.lines.length * 13),
	true
);

console.log('\n--- routing the connectors ---');

// A model with something in every layer and more elements than fit in one row,
// so all three route shapes are exercised: neighbours side by side, a hop to the
// next row, and a detour that has to get past whole rows of boxes on the way.
const wired = buildModel(
	[
		toElement({ type: 'actor', name: 'Employee' }, ''),
		toElement({ type: 'actor', name: 'Fleet office' }, ''),
		toElement({ type: 'service', name: 'Booking a car' }, ''),
		toElement({ type: 'service', name: 'My bookings' }, ''),
		toElement({ type: 'service', name: 'Blocking cars' }, ''),
		toElement({ type: 'service', name: 'Automatic behaviour' }, ''),
		toElement({ type: 'data', name: 'Booking' }, ''),
		toElement({ type: 'data', name: 'Pool car' }, ''),
		toElement({ type: 'system', name: 'Email' }, ''),
		toElement({ type: 'infrastructure', name: 'Company account' }, '')
	],
	[
		toRelation({ from: 'Employee', to: 'Booking a car', kind: 'assigned' }),
		toRelation({ from: 'Employee', to: 'Fleet office', kind: 'flow' }),
		toRelation({ from: 'Booking a car', to: 'Booking', kind: 'accesses' }),
		toRelation({ from: 'Blocking cars', to: 'Pool car', kind: 'accesses' }),
		toRelation({ from: 'Email', to: 'Employee', kind: 'flow' }),
		toRelation({ from: 'Company account', to: 'Booking a car', kind: 'serves' })
	]
);

const wiredLaid = layoutDiagram(wired);

check('every relation becomes a route', wiredLaid.edges.length, 6);

function segmentsOf(edge) {
	const segments = [];
	for (let i = 1; i < edge.points.length; i++) {
		segments.push({ a: edge.points[i - 1], b: edge.points[i] });
	}
	return segments;
}

const allSegments = wiredLaid.edges.flatMap(segmentsOf);

check(
	'every segment runs horizontally or vertically',
	allSegments.every(({ a, b }) => a.x === b.x || a.y === b.y),
	true
);

// The invariant the whole router exists for. Straight centre-to-centre lines ran
// underneath whatever lay between the two boxes, which made a relation
// impossible to follow with the eye — the one thing the picture is for. A
// segment may touch a border it leaves from; it may not overlap any interior.
function crossesInterior({ a, b }, box) {
	const overlap = (low, high, from, to) => Math.min(high, to) - Math.max(low, from) > 0.5;
	const inside = (value, low, high) => value > low + 0.5 && value < high - 0.5;

	if (a.x === b.x) {
		return (
			inside(a.x, box.x, box.x + box.width) &&
			overlap(Math.min(a.y, b.y), Math.max(a.y, b.y), box.y, box.y + box.height)
		);
	}
	return (
		inside(a.y, box.y, box.y + box.height) &&
		overlap(Math.min(a.x, b.x), Math.max(a.x, b.x), box.x, box.x + box.width)
	);
}

const underneath = wiredLaid.edges.flatMap((edge) =>
	segmentsOf(edge)
		.filter((segment) => wiredLaid.boxes.some((box) => crossesInterior(segment, box)))
		.map(() => `${edge.from} → ${edge.to}`)
);

check('no connector passes underneath a box', underneath, []);

// Clear of the boxes is not enough on its own: a corridor that was never given a
// lane defaulted to zero, which put four routes hard against the left edge of the
// picture, outside every band — and the check above was perfectly happy with it,
// because nothing out there is a box. Every corner has to be inside the drawing.
const frame = wiredLaid.bands[0];
check(
	'every corner of every route stays within the drawing',
	wiredLaid.edges
		.flatMap((edge) => edge.points.map((point) => ({ edge, point })))
		.filter(
			({ point }) =>
				point.x < frame.x ||
				point.x > frame.x + frame.width ||
				point.y < 0 ||
				point.y > wiredLaid.height
		)
		.map(({ edge, point }) => `${edge.from} → ${edge.to} at ${point.x},${point.y}`),
	[]
);

// The band names are text, not boxes, so the check above says nothing about
// them — and written across the top of a band, a name sat in the first gutter
// and the channel over the band's first row, where wires run.
function entersArea({ a, b }, area) {
	const left = Math.min(a.x, b.x);
	const right = Math.max(a.x, b.x);
	const top = Math.min(a.y, b.y);
	const bottom = Math.max(a.y, b.y);
	return right > area.x && left < area.x + area.width && bottom > area.y && top < area.y + area.height;
}
for (const [name, layout] of [
	['the wired example', wiredLaid],
	['one box per row', layoutDiagram(wired, { maxPerRow: 1 })],
	['four across', layoutDiagram(wired, { maxPerRow: 4 })]
]) {
	check(
		`no wire runs through a band's name (${name})`,
		layout.edges.flatMap((edge) =>
			segmentsOf(edge)
				.filter((segment) => layout.bands.some((band) => entersArea(segment, band.labelArea)))
				.map(() => `${edge.from} → ${edge.to}`)
		),
		[]
	);
}
check(
	'and no box sits on one',
	wiredLaid.boxes.filter((box) =>
		wiredLaid.bands.some((band) => entersArea({ a: { x: box.x, y: box.y }, b: { x: box.x + box.width, y: box.y + box.height } }, band.labelArea))
	),
	[]
);

const detour = wiredLaid.edges.find((e) => e.from === 'email');
check('a route spanning three rows bends round rather than cutting through', detour.points.length, 6);

const sideways = wiredLaid.edges.find((e) => e.to === 'fleet-office');
check('two neighbours are joined between their facing sides', sideways.points.length <= 4, true);

const leftNeighbour = wiredLaid.boxes.find((b) => b.id === 'employee');
const rightNeighbour = wiredLaid.boxes.find((b) => b.id === 'fleet-office');
check('leaving one on the right', sideways.x1, leftNeighbour.x + leftNeighbour.width);
check('and arriving on the other from the left', sideways.x2, rightNeighbour.x);

// Two wires meeting the same side of the same box have to arrive apart, or one
// hides the other and the box looks like it has half the connections it has.
const bookingCar = wiredLaid.boxes.find((b) => b.id === 'booking-a-car');
const downToBooking = wiredLaid.edges.find((e) => e.from === 'booking-a-car' && e.to === 'booking');
const upFromAccount = wiredLaid.edges.find((e) => e.from === 'company-account');
check(
	'both wires do meet the bottom of the box',
	[downToBooking.y1, upFromAccount.y2],
	[bookingCar.y + bookingCar.height, bookingCar.y + bookingCar.height]
);
check('but not at the same point on it', downToBooking.x1 !== upFromAccount.x2, true);

// Corridors are widened to fit their wiring rather than letting wires overlap.
const narrow = layoutDiagram(wired, { maxPerRow: 1 });
check('a taller arrangement still keeps every wire clear of every box',
	narrow.edges.flatMap(segmentsOf).filter((s) => narrow.boxes.some((b) => crossesInterior(s, b))),
	[]
);

console.log('\n--- drawing the route ---');

check('a straight route needs no curve', edgePath([{ x: 0, y: 0 }, { x: 0, y: 40 }]), 'M 0 0 L 0 40');

const cornered = edgePath([{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 60, y: 40 }]);
check('a corner becomes a curve', cornered.includes('Q 0 40'), true);
check('and the route still ends where it should', cornered.endsWith('L 60 40'), true);

// A radius wider than the segment would swing the line off its corridor, which
// is exactly where it was routed not to go.
check(
	'the radius shrinks to fit a short segment',
	edgePath([{ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 8 }]),
	'M 0 0 L 0 2 Q 0 4 2 4 L 4 4 Q 6 4 6 6 L 6 8'
);
check('every route carries its own path', wiredLaid.edges.every((e) => e.path.startsWith('M ')), true);

console.log('\n--- the ArchiMate exchange file ---');

check('an actor is a business actor', conceptFor('actor', 'business'), 'BusinessActor');
check(
	'a capability in the application layer is an application service',
	conceptFor('service', 'application'),
	'ApplicationService'
);
check(
	'the same word in the technology layer is a technology service',
	conceptFor('service', 'technology'),
	'TechnologyService'
);
check('information is a data object', conceptFor('data', 'application'), 'DataObject');
check('and in the technology layer an artifact', conceptFor('data', 'technology'), 'Artifact');
check('an unknown type still maps to something drawable', conceptFor('wibble', 'application'), 'ApplicationService');

check('assignment keeps its name', relationshipFor('assigned'), 'Assignment');
check('serves is a serving relationship', relationshipFor('serves'), 'Serving');
check('an unknown kind becomes an association rather than nothing', relationshipFor('wibble'), 'Association');
check('an ampersand in a name cannot break the file', escapeXml('Fleet & office'), 'Fleet &amp; office');

const exchange = toOpenExchange(wired, wiredLaid, {
	name: 'Pool cars',
	documentation: 'Derived from the design document.',
	chapterTitles: {}
});

const occurrences = (text, pattern) => (text.match(pattern) ?? []).length;

check(
	'the file declares the exchange namespace',
	exchange.includes('xmlns="http://www.opengroup.org/xsd/archimate/3.0/"'),
	true
);
check('every element is exported', occurrences(exchange, /<element /g), wired.elements.length);
check('every relation is exported', occurrences(exchange, /<relationship /g), wired.relations.length);
check('every box becomes a node in the view', occurrences(exchange, /<node /g), wiredLaid.boxes.length);
check('every route becomes a connection', occurrences(exchange, /<connection /g), wiredLaid.edges.length);
check('the corners travel with it as bendpoints', exchange.includes('<bendpoint '), true);
check('the layers become the model tree', exchange.includes('<label xml:lang="en">Technology</label>'), true);
check(
	'nodes come before connections, as the schema requires',
	exchange.indexOf('<node ') < exchange.indexOf('<connection '),
	true
);
check('reading and writing is stated rather than assumed', exchange.includes('accessType="ReadWrite"'), true);
check('the file is closed', exchange.trimEnd().endsWith('</model>'), true);

// The same rule the diagram follows: an end that is not there is not invented.
const partial = toOpenExchange(
	{
		elements: [{ id: 'a-thing', name: 'A thing', type: 'service', layer: 'application', chapter: '' }],
		relations: [{ from: 'a-thing', to: 'ghost', kind: 'serves' }]
	},
	{ boxes: [], edges: [] },
	{ name: 'Partial' }
);
check('a relation with a missing end is left out of the file', partial.includes('<relationship'), false);
check('and a model with nothing drawn still produces a valid file', partial.trimEnd().endsWith('</model>'), true);

console.log('\n--- void tags in the stream ---');

const voids = streamed([
	'Here it is.\n<element type="actor" name="Employee" />\n<relation from="Employee" to="Booking" kind="assigned" />\nDone.'
]);
check('void tags do not swallow the rest of the stream', voids.visible, 'Here it is.\n\nDone.');
check('and are captured', voids.parser.blocksOf('element').length, 1);
check('with their attributes', voids.parser.blocksOf('relation')[0].attrs.kind, 'assigned');

// The models omit the slash as often as not.
const noSlash = streamed(['<element type="actor" name="Employee">\nstill prose']);
check('a void tag without a slash also closes at once', noSlash.visible, 'still prose');

console.log('\n--- rendering a chapter into the preview ---');

// Chapter prose is model output shaped by whatever the user typed, and it is
// rendered with {@html} into every colleague's session. `marked` does not
// sanitise, so these are the tests that stand between a chapter and a script tag.

const scripted = renderMarkdown('Before\n\n<script>alert(1)</script>\n\nAfter');
check('a script tag in a chapter is not emitted as markup', scripted.includes('<script'), false);
check('it is shown as the text it is', scripted.includes('&lt;script&gt;'), true);
check('and the prose around it survives', scripted.includes('Before') && scripted.includes('After'), true);

// Inline HTML, not just block. The words "onerror=" survive as text, which is
// the point — what must not survive is the tag that would make them an attribute.
const handler = renderMarkdown('An image: <img src=x onerror="alert(1)">');
check('an inline tag never becomes an element', handler.includes('<img'), false);
check('it is escaped in place', handler.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'), true);

const blockHtml = renderMarkdown('Para\n\n<div onclick="x">hi</div>');
check('block-level html is escaped as well as inline', blockHtml.includes('<div'), false);

const jsLink = renderMarkdown('[Click here](javascript:alert(1))');
check('a javascript: link loses its href', jsLink.includes('href'), false);
check('but keeps its words', jsLink.includes('Click here'), true);

// Browsers ignore whitespace and control characters when resolving a scheme, so
// the scheme has to be read the way they read it, not the way it is written.
const obfuscated = renderMarkdown('[Click](java\tscript:alert(1))');
check('a scheme split by a tab is still javascript:', obfuscated.includes('href'), false);

const dataImage = renderMarkdown('![x](data:text/html;base64,PHNjcmlwdD4=)');
check('a data: image is not rendered', dataImage.includes('<img'), false);

check('an ordinary link survives', renderMarkdown('[Docs](https://example.com)').includes('href="https://example.com"'), true);
check('so does a relative one', renderMarkdown('[Chapter](/projects/1)').includes('href="/projects/1"'), true);
check('and markdown still renders', renderMarkdown('## Booking\n\n**Yes**').includes('<strong>Yes</strong>'), true);

check('an empty chapter renders as nothing', renderMarkdown('   '), '');

// The allow-list, directly. A deny-list would be a list of the attacks someone
// thought of; this has to hold against text the model chose.
check('https is allowed', safeUrl('https://example.com'), 'https://example.com');
check('mailto is allowed', safeUrl('mailto:someone@example.com'), 'mailto:someone@example.com');
check('a fragment is allowed', safeUrl('#requirements'), '#requirements');
check('a relative path is allowed', safeUrl('docs/070-security.md'), 'docs/070-security.md');
check('javascript is refused', safeUrl('javascript:alert(1)'), null);
check('leading whitespace does not disguise it', safeUrl('  JaVaScRiPt:alert(1)'), null);
check('data is refused', safeUrl('data:text/html,<script>'), null);
check('vbscript is refused', safeUrl('vbscript:msgbox'), null);

// A browser decodes character references in an attribute before it reads the
// scheme, so an encoded letter or colon is the same javascript: URL.
check('an encoded letter does not disguise javascript', safeUrl('&#106;avascript:alert(1)'), null);
check('nor a hexadecimal one', safeUrl('&#x6A;avascript:alert(1)'), null);
check('nor one without its semicolon', safeUrl('&#106avascript:alert(1)'), null);
check('nor a named colon', safeUrl('javascript&colon;alert(1)'), null);
check('an unknown reference where the scheme would be is refused', safeUrl('javascript&foo;alert(1)'), null);
check('an ampersand in a query is still an ordinary path', safeUrl('/search?a=1&b=2'), '/search?a=1&b=2');
check('an encoded link renders without its href', renderMarkdown('[Open](&#106;avascript:alert(1))').includes('href'), false);

// marked writes image alt text into the attribute unescaped. A quote in it was a
// handler that fired for every reader, with no click.
const altBreakout = renderMarkdown('![x" onerror="alert(1)](nope.png)');
check('image alt text cannot close its attribute', altBreakout.includes('onerror="'), false);
check('the image itself still renders', altBreakout.includes('<img src="nope.png"'), true);
check('with its words escaped', altBreakout.includes('alt="x&quot; onerror=&quot;alert(1)"'), true);
const titled = renderMarkdown('[Docs](https://example.com "a\\" onmouseover=\\"x")');
check('a link title cannot close its attribute', titled.includes('onmouseover="'), false);
check('an ampersand in a link is escaped once', renderMarkdown('[q](https://x.test/?a=1&b=2)').includes('href="https://x.test/?a=1&amp;b=2"'), true);

console.log('\n--- telling the user what went wrong ---');

const gatewayError = Object.assign(new Error('Gateway stream failed with 502'), { name: 'GatewayError' });
check('a gateway failure is described, not quoted', describeFailure(gatewayError).includes('502'), false);
check('and says their words are kept', describeFailure(gatewayError).includes('Your message is saved'), true);
check('running out of room says what to do', describeFailure(new Error('The gateway ran out of room before completing its response.')).includes('one part at a time'), true);
check('a network failure says try again', describeFailure(new TypeError('fetch failed')).includes('Try again in a minute'), true);
check('a database error is not quoted', describeFailure(new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed')).includes('SQLITE'), false);
const lostHistory = Object.assign(new Error('No repository at /srv/data/repos/x'), { name: 'RepositoryMissing' });
check('a lost history is not offered "try again"', /try again/i.test(describeFailure(lostHistory)), false);
check('and says who can restore it, without the path', [describeFailure(lostHistory).includes('looks after Specman'), describeFailure(lostHistory).includes('/srv')], [true, false]);
const conflict = Object.assign(new Error('The document changed while the assistant was working.'), { name: 'DocumentConflict' });
check('a message already written for the user is kept', describeFailure(conflict), conflict.message);
check('nothing is promised when nothing was saved', describeFailure(gatewayError, { messageSaved: false }).includes('saved'), false);

console.log('\n--- where sign-in returns to ---');

check('a plain path is kept', safeReturnPath('/projects/4?chapter=security#x'), '/projects/4?chapter=security#x');
check('a scheme-relative address goes home', safeReturnPath('//evil.example'), '/');
check('so does a backslash one', safeReturnPath('/\\evil.example'), '/');
// The browser's URL parser drops tabs and newlines before resolving.
check('a tab cannot turn a path into another host', safeReturnPath('/\t/evil.example'), '/');
check('nor a newline', safeReturnPath('/\n/evil.example'), '/');
check('an absolute address goes home', safeReturnPath('https://evil.example/'), '/');
check('nothing at all goes home', safeReturnPath(null), '/');
// Resolves on this host to the path `//evil.example`, which the browser reads again.
check('a dot segment cannot leave a scheme-relative path', safeReturnPath('/..//evil.example'), '/');
check('nor with a backslash', safeReturnPath('/../\\evil.example'), '/');
check('nor from deeper down', safeReturnPath('/a/../..//evil.example/x'), '/');
check('a dot segment that stays home is resolved', safeReturnPath('/projects/../projects/4'), '/projects/4');

console.log('\n--- failed sign-in attempts ---');

let clock = 0;
const attempts = new SignInAttempts(() => clock);
for (let i = 0; i < FREE_ATTEMPTS - 1; i++) attempts.failed('10.0.0.1', 'novak');
check('a few mistakes cost nothing', attempts.waitFor('10.0.0.1', 'novak'), 0);
attempts.failed('10.0.0.1', 'novak');
check('then a wait begins', attempts.waitFor('10.0.0.1', 'novak') > 0, true);
check('the name is not matched case by case', attempts.waitFor('10.0.0.1', 'NOVAK') > 0, true);
check('another address is not held up by it', attempts.waitFor('10.0.0.2', 'novak'), 0);
const firstWait = attempts.waitFor('10.0.0.1', 'novak');
clock += firstWait;
attempts.failed('10.0.0.1', 'novak');
check('each further failure waits longer', attempts.waitFor('10.0.0.1', 'novak') > firstWait, true);
for (let i = 0; i < 30; i++) attempts.failed('10.0.0.1', 'novak');
check('up to a ceiling', attempts.waitFor('10.0.0.1', 'novak') <= 15 * 60_000, true);
attempts.succeeded('10.0.0.1', 'novak');
check('a success forgets the history', attempts.waitFor('10.0.0.1', 'novak'), 0);

console.log('\n--- a turn that outlives the tab ---');

check('an event is one frame', sseFrame('state', { key: 'security' }), 'event: state\ndata: {"key":"security"}\n\n');

// A chapter is many lines, and SSE gives `data:` one. JSON escaping is what
// keeps it on that line; losing it would truncate the chapter at its first
// blank line, silently.
const multiline = sseFrame('chapter', { markdown: 'One.\n\nTwo.' });
check('a multi-line payload stays on one data line', multiline.split('\n').length, 4);
check('and its newlines survive as escapes', multiline.includes('One.\\n\\nTwo.'), true);

// The turn writes as it works. Once the browser is gone every later write has to
// be a no-op, because the work after it is the part that must not be lost.
const written = [];
let failFrom = Infinity;
const sink = createSink((frame) => {
	if (written.length >= failFrom) throw new TypeError('Invalid state: Controller is already closed');
	written.push(frame);
});

sink.send('text', { delta: 'Recording that.' });
check('an ordinary event is delivered', written.length, 1);
check('and the sink is still connected', sink.connected, true);

// The tab closes: the stream is cancelled, so enqueueing throws.
failFrom = 1;
let threw = false;
try {
	sink.send('chapter', { key: 'security' });
} catch {
	threw = true;
}
check('a write to a cancelled stream does not throw at the caller', threw, false);
check('the sink notices it is gone', sink.connected, false);
check('and counts what was lost', sink.dropped, 1);

// This is the whole point: the turn keeps going, and everything it does after
// the tab closed still runs rather than aborting at the first failed write.
sink.send('requirement', { ref: 'REQ-001' });
sink.send('commit', { hash: 'abc12345' });
check('later events are dropped rather than attempted', written.length, 1);
check('and every one of them is counted', sink.dropped, 3);

sink.disconnect();
check('disconnecting an already-gone sink changes nothing', sink.dropped, 3);

// A payload we cannot serialise is our bug, not a browser leaving. The two must
// not look the same: one is routine and the other should be loud.
const loud = createSink(() => {});
const circular = {};
circular.self = circular;
let raised = false;
try {
	loud.send('chapter', circular);
} catch {
	raised = true;
}
check('an unserialisable payload is raised, not swallowed', raised, true);
check('and is not mistaken for a disconnect', loud.connected, true);

// The sink only helps if the work around it actually keeps running once the
// stream is cancelled. That is a property of the runtime, not of our code, so it
// is worth pinning rather than assuming: this is the same shape as the chat
// route, driven against a real ReadableStream.
{
	const steps = [];
	let sink = null;
	let finished = null;
	let go;
	const gate = new Promise((resolve) => (go = resolve));

	const stream = new ReadableStream({
		async start(controller) {
			const live = createSink((frame) => controller.enqueue(new TextEncoder().encode(frame)));
			sink = live;
			finished = (async () => {
				live.send('text', { delta: 'Recording that.' });
				steps.push('replied');
				await gate;
				live.send('chapter', { key: 'security' });
				steps.push('saved the chapter');
				live.send('commit', { hash: 'abc12345' });
				steps.push('committed');
				return { connected: live.connected, dropped: live.dropped };
			})();
			await finished;
		},
		cancel() {
			steps.push('browser left');
			sink?.disconnect();
		}
	});

	const reader = stream.getReader();
	await reader.read();
	await reader.cancel(); // the tab closes
	go(); // …and the turn carries on from where it was
	const outcome = await finished;

	check('the browser leaves part-way through', steps, [
		'replied',
		'browser left',
		'saved the chapter',
		'committed'
	]);
	check('the turn still finishes its work', outcome.connected, false);
	check('and says how much nobody saw', outcome.dropped, 2);
}

console.log('\n--- an identity asserted by the reverse proxy ---');

const headers = (map) => (name) => map[name] ?? null;

check('no header asserts nobody', readForwardedIdentity(headers({})), null);
check('an empty header asserts nobody', readForwardedIdentity(headers({ 'x-forwarded-user': '  ' })), null);

check(
	'the authenticated account is the identity',
	readForwardedIdentity(
		headers({
			'x-forwarded-user': 'Novak.Jan',
			'x-forwarded-email': 'jan.novak@example.com',
			'x-forwarded-preferred-username': 'jnovak'
		})
	),
	{ username: 'novak.jan', displayName: 'jnovak', email: 'jan.novak@example.com' }
);

// The preferred name is what to show. Taking it as the account name would move
// someone onto a different account here the day the directory renames them.
check(
	'a preferred name is display only',
	readForwardedIdentity(headers({ 'x-forwarded-user': 'novak.jan', 'x-forwarded-preferred-username': 'jnovak' }))
		.username,
	'novak.jan'
);

check(
	'without one, the account name is shown',
	readForwardedIdentity(headers({ 'x-forwarded-user': 'novak.jan' })).displayName,
	'novak.jan'
);

// Which address a failed password is counted against. Behind the proxy, every
// attempt came from the proxy, and one person's typos locked out everyone.
check('behind the proxy, the caller it saw is counted', attemptAddress('10.0.0.4', '198.51.100.7, 192.0.2.1', true), '192.0.2.1');
check('without proxy sign-in the header is nobody\'s word', attemptAddress('203.0.113.9', '192.0.2.1', false), '203.0.113.9');
check('a proxy that sent no header is counted itself', attemptAddress('10.0.0.4', null, true), '10.0.0.4');
check('an empty header is no address', attemptAddress('10.0.0.4', ' , ', true), '10.0.0.4');

console.log('\n--- one writer at a time, per repository ---');

{
	const locks = createLocks();
	const trace = [];

	// Each "turn" is the shape the real one is: check out, write, commit. The bug
	// was never one step — it was another turn arriving between two of them.
	const turn = (name) => async () => {
		trace.push(`${name}: checkout`);
		await new Promise((r) => setTimeout(r, 5));
		trace.push(`${name}: write`);
		await new Promise((r) => setTimeout(r, 5));
		trace.push(`${name}: commit`);
		return name;
	};

	const done = await Promise.all([
		locks.run('/repos/booking', turn('first')),
		locks.run('/repos/booking', turn('second'))
	]);

	check('both turns finish', done, ['first', 'second']);
	check('and neither is interleaved with the other', trace, [
		'first: checkout',
		'first: write',
		'first: commit',
		'second: checkout',
		'second: write',
		'second: commit'
	]);
	check('nothing is left held', locks.pending, 0);
}

{
	// Ordering is per repository. Two applications must not wait on each other —
	// that would turn a busy conversation into a queue for everybody.
	const locks = createLocks();
	const trace = [];
	let releaseFirst;
	const blocked = new Promise((resolve) => (releaseFirst = resolve));

	const one = locks.run('/repos/booking', async () => {
		trace.push('booking started');
		await blocked;
		trace.push('booking finished');
	});
	const two = locks.run('/repos/fleet', async () => {
		trace.push('fleet ran while booking was held');
	});

	await two;
	releaseFirst();
	await one;

	check('a different repository does not wait', trace, [
		'booking started',
		'fleet ran while booking was held',
		'booking finished'
	]);
}

{
	// A holder that throws must still release. Otherwise the first git failure
	// wedges that application until the server restarts.
	const locks = createLocks();
	let failed = false;

	await locks.run('/repos/booking', async () => {
		throw new Error('git exploded');
	}).catch(() => (failed = true));

	check('a failing holder reports its failure', failed, true);
	const after = await locks.run('/repos/booking', async () => 'still works');
	check('and the repository is not wedged behind it', after, 'still works');
	check('nothing is left held after a failure', locks.pending, 0);
}

{
	// Failing the caller cannot cancel its writes. Ownership survives timeout.
	const locks = createLocks(20);
	let message = '';
	let settle;
	const gate = new Promise((resolve) => { settle = resolve; });
	let active = 0;
	let maximum = 0;

	await locks
		.run('/repos/booking', async () => {
			maximum = Math.max(maximum, ++active);
			await gate;
			active--;
		})
		.catch((cause) => (message = cause.message));

	check('a hung holder times out rather than blocking for ever', message.includes('Timed out'), true);
	check('and names the repository it was waiting on', message.includes('/repos/booking'), true);
	check('the timed-out writer retains ownership', locks.pending, 1);
	let started = false;
	const next = locks.run('/repos/booking', async () => {
		started = true;
		maximum = Math.max(maximum, ++active);
		active--;
		return 'ok';
	});
	await new Promise(setImmediate);
	check('the next writer waits for actual settlement', started, false);
	check('other repositories proceed while the timed-out writer continues', await locks.run('/repos/fleet', async () => 'independent'), 'independent');
	settle();
	check('the next writer proceeds after settlement', await next, 'ok');
	check('timeout never allows overlapping writers', maximum, 1);
	check('all settled queues are removed', locks.pending, 0);
}

{
	const locks = createLocks(20);
	let reject;
	await locks.run('/repos/booking', () => new Promise((_, fail) => { reject = fail; })).catch(() => {});
	const next = locks.run('/repos/booking', async () => 'recovered');
	reject(new Error('late failure'));
	check('late rejection releases ownership without an unhandled rejection', await next, 'recovered');
	await locks.run('/repos/booking', () => { throw new Error('synchronous failure'); }).catch(() => {});
	check('a synchronous throw also releases ownership', await locks.run('/repos/booking', async () => 'ok'), 'ok');
}

console.log('\n--- reading the turn back in the browser ---');

check('a whole frame is read', readFrames('event: state\ndata: {"key":"security"}\n\n'), {
	events: [{ name: 'state', data: { key: 'security' } }],
	rest: ''
});

// A chapter arrives over many reads. A frame cut down the middle must be held,
// not parsed as two — the half that reaches the screen would be the wrong half.
const firstHalf = readFrames('event: text\ndata: {"delta":"Recor');
check('half a frame yields nothing', firstHalf.events, []);
check('and is kept for the next chunk', firstHalf.rest, 'event: text\ndata: {"delta":"Recor');
check(
	'the other half completes it',
	readFrames(firstHalf.rest + 'ding that."}\n\n').events,
	[{ name: 'text', data: { delta: 'Recording that.' } }]
);

check(
	'several frames in one chunk all arrive, in order',
	readFrames(
		'event: text\ndata: {"delta":"A"}\n\nevent: text\ndata: {"delta":"B"}\n\nevent: done\ndata: {}\n\n'
	).events.map((e) => e.name),
	['text', 'text', 'done']
);

// Dropping one unreadable frame costs a word; ending the stream costs the turn.
check(
	'an unreadable frame is skipped rather than ending the stream',
	readFrames('event: text\ndata: {oops\n\nevent: done\ndata: {}\n\n').events,
	[{ name: 'done', data: {} }]
);

console.log('\n--- who else is in this document ---');

{
	const presence = createPresence(45_000);
	const t0 = 1_000_000;

	presence.seen(1, 10, 'Jan Novák', t0);
	presence.seen(1, 11, 'Eva Dvořáková', t0);
	presence.seen(2, 12, 'Someone Else', t0);

	check('I am not company for myself', presence.others(1, 10, t0).map((w) => w.name), [
		'Eva Dvořáková'
	]);
	check('another document is another room', presence.others(2, 12, t0), []);

	presence.setWriting(1, 11, true, t0);
	check('writing is visible to the other person', presence.others(1, 10, t0), [
		{ name: 'Eva Dvořáková', writing: true }
	]);

	presence.setWriting(1, 11, false, t0);
	check('and so is stopping', presence.others(1, 10, t0)[0].writing, false);

	// Two tabs, two turns: the first to finish must not clear the second.
	presence.setWriting(1, 11, true, t0);
	presence.setWriting(1, 11, true, t0);
	presence.setWriting(1, 11, false, t0);
	check('one of two turns finishing leaves them writing', presence.others(1, 10, t0)[0].writing, true);
	presence.setWriting(1, 11, false, t0);
	check('both finishing does not', presence.others(1, 10, t0)[0].writing, false);
	presence.setWriting(1, 11, false, t0);
	check('an extra finish cannot go below nothing', (presence.setWriting(1, 11, true, t0), presence.others(1, 10, t0)[0].writing), true);
	presence.setWriting(1, 11, false, t0);

	// Someone who closed their laptop should stop being company, without anything
	// having to tell us they left.
	const later = t0 + 46_000;
	presence.seen(1, 10, 'Jan Novák', later);
	check('a colleague who went quiet drops out', presence.others(1, 10, later), []);
	// Sweeping is global rather than per document, so the person sitting in the
	// other one is cleared out by the same pass. Only Jan, who just pinged, is
	// left — a registry that only forgot people in rooms someone was looking at
	// would grow for ever in the rooms nobody was.
	check('and nor is anyone else who went quiet, in any document', presence.size, 1);
}

{
	// A turn is itself a sign of life: a tab that started one before its first
	// ping must not be invisible to everybody else.
	const presence = createPresence(45_000);
	presence.setWriting(3, 20, true, 500);
	presence.seen(3, 21, 'Watcher', 500);
	check('a turn counts as being present', presence.others(3, 21, 500).length, 0);
	presence.seen(3, 20, 'Jan Novák', 500);
	check('once they are named, they are company', presence.others(3, 21, 500), [
		{ name: 'Jan Novák', writing: true }
	]);
	// A long turn outlasts the expiry; the mark has to outlast it with the turn.
	presence.seen(3, 21, 'Watcher', 90_000);
	check('a turn still running keeps them writing past the expiry', presence.others(3, 21, 90_000), [
		{ name: 'Jan Novák', writing: true }
	]);
	presence.setWriting(3, 20, false, 90_000);
	presence.seen(3, 21, 'Watcher', 140_000);
	check('and once it finishes they go quiet like anyone else', presence.others(3, 21, 140_000), []);
}

{
	// The drafter asks whether anybody at all is mid-turn, the asker included.
	const presence = createPresence(45_000);
	presence.seen(4, 30, 'Jan Novák', 0);
	check('someone merely looking is not writing', presence.writing(4), false);
	presence.setWriting(4, 30, true, 0);
	check('a turn running is writing, even for the one asking', presence.writing(4), true);
	check('in that application only', presence.writing(5), false);
	presence.setWriting(4, 30, false, 0);
	check('and stops when the turn does', presence.writing(4), false);
}

console.log('\n--- the folder an application lives in ---');

check('a name becomes a folder name', baseSlug('Půjčování aut'), 'pujcovani-aut');
check('a Windows device name is given a suffix', baseSlug('Con'), 'con-app');
check('in any case', baseSlug('NUL'), 'nul-app');
check('and the numbered ones too', baseSlug('LPT1'), 'lpt1-app');
check('a name merely starting with one is left alone', baseSlug('Console'), 'console');
check('nothing usable still gives a folder', baseSlug('???'), 'app');
check(
	'a taken slug counts up',
	uniqueSlug('Fleet', (slug) => ['fleet', 'fleet-2'].includes(slug)),
	'fleet-3'
);

console.log('\n--- conditions an administrator types ---');

check('known conditions are read', readConditions('personal_data, critical'), {
	conditions: ['personal_data', 'critical']
});
check('a blank field means always, not never', readConditions('  '), { conditions: ['always'] });
check('a typo is refused by name rather than read as always', readConditions('personal-data, critical'), {
	unknown: ['personal-data']
});
check('case and repeats do not matter', readConditions('Critical, critical'), { conditions: ['critical'] });

console.log('\n--- what a drawn element may link to ---');

check(
	'a chapter key is kept',
	toElement({ type: 'actor', name: 'Employee', chapter: 'Users-and-roles' }, '').chapter,
	'users-and-roles'
);
check(
	'anything not shaped like a key is dropped rather than put in an address',
	toElement({ type: 'actor', name: 'Employee', chapter: 'x&y=1"><script>' }, '').chapter,
	''
);
check('a name with nothing a slug can keep is not drawn', toElement({ type: 'actor', name: '日本語' }, ''), null);

console.log('\n--- section keys that are already chapters ---');

{
	const elsewhere = ['overview', 'data', 'integration', 'what-it-does'];
	const claimed = claimSectionKeys(
		[
			{ key: 'booking', title: 'Booking a car' },
			{ key: 'data', title: 'The data it keeps' },
			{ key: 'what-it-does', title: 'In short' }
		],
		'what-it-does',
		elsewhere
	);
	check('a key nobody uses is kept', claimed[0].key, 'booking');
	check('a key another chapter has is put under the parent', claimed[1].key, 'what-it-does-data');
	check('and so is the parent’s own', claimed[2].key, 'what-it-does-what-it-does');
	check('the same plan gives the same keys next time', claimSectionKeys([{ key: 'data', title: 'x y' }], 'what-it-does', elsewhere)[0].key, 'what-it-does-data');
	check('a prefixed key that is taken too is numbered', claimSectionKeys([{ key: 'data', title: 'x y' }], 'what-it-does', [...elsewhere, 'what-it-does-data'])[0].key, 'what-it-does-data-2');
}

console.log('\n--- an empty chapter is not complete ---');

check('an assessment of complete over no prose is in progress', reconcileAssessment({ status: 'complete', openQuestions: [] }, 'Done.', [], false)?.status, 'in_progress');
check('with prose it stands', reconcileAssessment({ status: 'complete', openQuestions: [] }, 'Done.', [], true)?.status, 'complete');
check('nor does a navigation-only verdict complete it', reconcileAssessment({ status: 'in_progress', openQuestions: ['Shall we look at Security next?'] }, 'Done.', ['Security'], false)?.status, 'in_progress');

console.log('\n--- a rule restated without its reference ---');

check('the same words are the same rule', sameStatement('The car must be returned by 18:00.', '  the car must be returned  by 18:00'), true);
check('a different word is a different rule', sameStatement('The car must be returned by 18:00.', 'The car must be returned by 17:00.'), false);
check('nothing is never the same as nothing', sameStatement('', ''), false);
check('a lower-case reference names the stored one', toRequirementDraft({ ref: 'req-004' }, 'The rule is restated here.').ref, 'REQ-004');

console.log('\n--- who a decision belongs to ---');

check('the user’s own answer stays theirs', attributeDecision('user', 'Email is enough, nothing inside the app.'), 'user');
check('“you decide” makes it the assistant’s', attributeDecision('user', 'Honestly, you decide.'), 'agent');
check('so does “I don’t know”, with either apostrophe', [attributeDecision('user', "I don't know"), attributeDecision('user', 'I don’t know')], ['agent', 'agent']);
check('and in Czech', attributeDecision('user', 'Nevím, rozhodni ty.'), 'agent');
check('a word merely containing one is not one', attributeDecision('user', 'We use the Undecided folder for these.'), 'user');
check('the assistant’s own stays the assistant’s', attributeDecision('agent', 'Fine.'), 'agent');
check('a model cannot call its choice a company standard', normaliseSource('standard'), 'agent');

console.log('\n--- tags written loosely ---');

{
	const parser = new ChapterStreamParser();
	const shown = parser.push('<chapter key=security>Only staff.</Chapter>Recorded.') + parser.end();
	check('an unquoted attribute is read', [...parser.drafts.keys()], ['security']);
	check('a closing tag in another case closes the block', parser.drafts.get('security'), 'Only staff.');
	check('and nothing of it reaches the chat', shown, 'Recorded.');
}
{
	const parser = new ChapterStreamParser();
	const shown = parser.push('<requirement scope=now>Every booking is confirmed by email.\nWHEN booked\nTHEN mailed</requirement >Done.') + parser.end();
	check('a space before the closing bracket still closes', [parser.blocksOf('requirement').length, parser.blocksOf('requirement')[0].attrs.scope, shown], [1, 'now', 'Done.']);
}

console.log('\n--- keeping a quiet stream open ---');

{
	const frames = [];
	const sink = createSink((frame) => frames.push(frame));
	sink.ping();
	check('a ping is a comment line', frames, [': still working\n\n']);
	check('which the page reads as nothing', readFrames(frames[0]).events, []);
	sink.disconnect();
	sink.ping();
	check('and is not sent once the browser has gone', frames.length, 1);
}

console.log('\n--- asking Gemini ---');

{
	const body = geminiBody({
		system: 'Be brief.',
		messages: [
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi' },
			{ role: 'user', content: 'Again' }
		],
		maxTokens: 16000
	});
	check('the system prompt is an instruction, not a turn', body.systemInstruction, { parts: [{ text: 'Be brief.' }] });
	check('the assistant speaks as the model', body.contents.map((turn) => turn.role), ['user', 'model', 'user']);
	check('the whole budget is passed on', body.generationConfig, { maxOutputTokens: 16000 });
	check('a prose call carries no tools', [body.tools, body.toolConfig], [undefined, undefined]);
	check('a budget beyond what Gemini will write is brought within it, rather than refused',
		[geminiBody({ messages: [], maxTokens: 1_000_000 }).generationConfig.maxOutputTokens, geminiRoom(GEMINI_MAX_OUTPUT_TOKENS), geminiRoom(64_000)],
		[GEMINI_MAX_OUTPUT_TOKENS, GEMINI_MAX_OUTPUT_TOKENS, 64_000]);

	const schema = { type: 'object', properties: { status: { type: 'string', enum: ['done'] } }, required: ['status'] };
	const forced = geminiBody({
		messages: [{ role: 'user', content: 'Record it' }],
		maxTokens: 1500,
		tools: [{ name: 'record', description: 'Record', input_schema: schema }],
		forceTool: 'record'
	});
	check('a tool keeps its JSON Schema as it is', forced.tools[0].functionDeclarations[0].parametersJsonSchema, schema);
	check('a forced tool is the only one allowed', forced.toolConfig, {
		functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['record'] }
	});
	check('no system prompt, no instruction', 'systemInstruction' in forced, false);

	const chunk = readGeminiPayload({
		candidates: [{ content: { parts: [{ text: 'weighing it', thought: true }, { text: 'Hello' }] } }],
		modelVersion: 'gemini-2.5-flash'
	});
	check('a thought is never the answer', [chunk.text, chunk.thinking], ['Hello', 'weighing it']);
	check('the serving model is reported', chunk.model, 'gemini-2.5-flash');
	check('a chunk mid-answer has not finished', chunk.finishReason, null);

	const last = readGeminiPayload({
		candidates: [{ content: { parts: [{ text: '.' }] }, finishReason: 'STOP' }],
		usageMetadata: { candidatesTokenCount: 40, thoughtsTokenCount: 900 }
	});
	check('the last chunk says how it finished', last.finishReason, 'STOP');
	check('reasoning counts against the budget with the answer', last.outputTokens, 940);

	const call = readGeminiPayload({
		candidates: [{ content: { parts: [{ functionCall: { name: 'record', args: { status: 'done' } } }] }, finishReason: 'STOP' }]
	});
	check('a function call is read as a tool call', call.calls, [{ name: 'record', input: { status: 'done' } }]);

	check('a refused question finishes with the reason', readGeminiPayload({ promptFeedback: { blockReason: 'SAFETY' } }).finishReason, 'SAFETY');
	check('an error frame is an error', readGeminiPayload({ error: { code: 503, status: 'UNAVAILABLE', message: 'busy' } }).error, {
		code: 503, status: 'UNAVAILABLE', message: 'busy'
	});

	check('STOP is the only ordinary ending', [ending('STOP'), ending('MAX_TOKENS'), ending('SAFETY'), ending('MALFORMED_FUNCTION_CALL')],
		['complete', 'out-of-room', 'refused', 'refused']);
	check('busy and failing are worth asking again', [geminiRetryable(429), geminiRetryable(503), geminiRetryable(200, 'RESOURCE_EXHAUSTED')], [true, true, true]);
	check('a bad request or a bad key is not', [geminiRetryable(400), geminiRetryable(403)], [false, false]);
	check('a model named with its prefix is the same model', geminiModelPath('models/gemini-flash-latest'), 'gemini-flash-latest');
}

console.log('\n--- which model answers ---');

{
	let now = 1_000_000;
	const routing = new ModelRouting(() => now);
	check('the primary is asked first, Gemini after', routing.order(true, true), ['primary', 'fallback']);
	check('without Gemini, only the primary', routing.order(true, false), ['primary']);
	check('without the primary, Gemini alone', routing.order(false, true), ['fallback']);
	check('with neither, nobody', routing.order(false, false), []);

	routing.failed('primary');
	check('a primary that has just failed is asked second', routing.order(true, true), ['fallback', 'primary']);
	check('but still asked, when it is all there is', routing.order(true, false), ['primary']);
	now += PRIMARY_REST_MS - 1;
	check('for the whole of its rest', routing.order(true, true)[0], 'fallback');
	now += 1;
	check('and first again after it', routing.order(true, true)[0], 'primary');

	routing.failed('primary');
	routing.succeeded('primary');
	check('a primary that answers is trusted again at once', routing.order(true, true)[0], 'primary');
	routing.failed('fallback');
	check('Gemini failing does not rest the primary', routing.order(true, true)[0], 'primary');

	check('a call that failed before passing anything on goes elsewhere', mayAskNext(false, false), true);
	check('one that already passed text on does not — it would be repeated', mayAskNext(true, false), false);
	check('nor one the caller gave up on', mayAskNext(false, true), false);

	const primaryNoRoom = new Error('The gateway ran out of room before completing its response.');
	const geminiNoRoom = new Error('Gemini ran out of room before completing its response.');
	const refused = new Error('Gemini stream failed with 401');
	const outage = new Error('Gateway stream failed with 502');
	check('running out of room is read from either provider\'s words, and nothing else',
		[ranOutOfRoom(primaryNoRoom), ranOutOfRoom(geminiNoRoom), ranOutOfRoom(refused), ranOutOfRoom(undefined), ranOutOfRoom('ran out of room')],
		[true, true, false, false, false]);

	const roomy = new ModelRouting(() => now);
	roomy.failed('primary', primaryNoRoom);
	check('a primary that ran out of room is not rested — it answered; the request was too big', roomy.order(true, true)[0], 'primary');
	roomy.failed('primary', outage);
	check('one that is down is', roomy.order(true, true)[0], 'fallback');

	check('when both fail, the primary running out of room is reported over Gemini refusing its key',
		failureToReport([primaryNoRoom, refused]), primaryNoRoom);
	check('Gemini running out of room is reported over a primary asked after it', failureToReport([geminiNoRoom, outage]), geminiNoRoom);
	check('when both ran out, the first', failureToReport([primaryNoRoom, geminiNoRoom]), primaryNoRoom);
	check('when neither did, the last, as before', failureToReport([outage, refused]), refused);
	check('read through whatever each failure is recorded as',
		failureToReport([{ route: 'primary', cause: primaryNoRoom }, { route: 'fallback', cause: refused }], (f) => f.cause).route, 'primary');
}

console.log('\n--- how much room each call is given ---');

{
	const all = Object.entries(budgets);
	check('no call that reads a chapter or a document has less than 16 000',
		all.filter(([, room]) => room < 16_000).map(([name]) => name), []);
	// The most each kind has been seen to use, on the live gateway.
	const measured = { TURN_BUDGET: 14_261, DRAFT_BUDGET: 14_261, SCREENS_BUDGET: 4_606, MOCKUP_BUDGET: 25_168, OVERVIEW_BUDGET: 5_361 };
	check('each is at least twice the most its kind has been seen to use',
		Object.entries(measured).filter(([name, used]) => budgets[name] < 2 * used).map(([name]) => name), []);
	check('asked again, a draft is given more room than the first time', budgets.DRAFT_RETRY_BUDGET > budgets.DRAFT_BUDGET, true);
	check('and none asks for more than Gemini can write, so the fallback is given the same room',
		all.filter(([, room]) => room > GEMINI_MAX_OUTPUT_TOKENS).map(([name]) => name), []);

	// As the live gateway reported a repeated prompt on 2026-10-03.
	check('the log says how much of a prompt came from the cache, counting the cached part in the prompt',
		describeUsage({ input_tokens: 220, output_tokens: 1832, cache_read_input_tokens: 38400 }),
		'1832 output tokens; prompt 38620, 38400 of it cached (99%)');
	check('and a cold one as none of it', describeUsage({ input_tokens: 38620, output_tokens: 2000 }), '2000 output tokens; prompt 38620, 0 of it cached (0%)');
	check('a backend that reports no prompt says only what it wrote', [describeUsage(undefined, 96), describeUsage({ output_tokens: 5 })], ['96 output tokens', '5 output tokens']);
}

console.log('\n--- what the interviewer is shown ---');

{
	const chapter = (key, title, content_md = '', extra = {}) => ({
		key, title, content_md, status: content_md ? 'in_progress' : 'empty', open_questions: [], applicable: 1,
		parent_key: '', purpose: '', questions: [], criteria: [], goal: '', is_dynamic: 0, ...extra
	});
	const rule = (ref, chapter_key, statement, source = 'user') => ({ ref, chapter_key, statement, scope: 'now', source });
	const chapters = [
		chapter('overview', 'Overview', 'Pool cars for the plant.'),
		chapter('users-and-roles', 'Users and roles', 'Managers see every booking, with its purpose.'),
		chapter('data', 'Data', 'Bookings keep who, which car and the day.', { open_questions: ['How long are bookings kept?'] }),
		chapter('integrations', 'Integrations', 'Nothing yet.', { applicable: 0 }),
		chapter('reporting', 'Reporting')
	];
	const rules = [rule('REQ-001', 'users-and-roles', 'A manager sees only their own team.'), rule('REQ-002', 'data', 'A booking names one car.')];

	const { text: rest, shown } = documentContext(chapters, rules, chapters[2]);
	check('the rest of the document carries the other chapters\' prose, so a contradiction can be seen',
		rest.includes('Managers see every booking, with its purpose.'), true);
	check('and their rules', rest.includes('- REQ-001 [now] A manager sees only their own team.'), true);
	check('but not the chapter under discussion, which comes with the message', [rest.includes('Bookings keep who'), rest.includes('REQ-002')], [false, false]);
	check('nor a chapter the triage set aside', rest.includes('Integrations'), false);
	check('in document order, an empty chapter said to be empty',
		[rest.indexOf('## Overview') < rest.indexOf('## Users and roles'), rest.includes('## Reporting (key: reporting)\n(nothing written yet)')], [true, true]);
	check('a document that fits is shown whole', [...shown.values()].every((s) => s === 'full'), true);
	check('nothing at all when there is no other chapter', documentContext([chapters[2]], rules, chapters[2]).text, '');
	check('the whole-document conversation sees every chapter', documentContext(chapters, rules, null).text.includes('Bookings keep who'), true);

	// A long document: each chapter far longer than the room, and one rule each.
	const paragraph = (topic, i) => `The ${topic} part ${i} begins here. ${'It goes on with detail nobody needs in an outline. '.repeat(12)}`;
	const body = (topic) => `## About ${topic}\n\n${Array.from({ length: 12 }, (_, i) => paragraph(topic, i)).join('\n\n')}`;
	const big = [
		chapter('overview', 'Overview', body('the plant')),
		chapter('users-and-roles', 'Users and roles', body('managers and bookings'), { purpose: 'Who uses the application and what each may see.' }),
		chapter('data', 'Information held', body('bookings and cars'), { purpose: 'What the application keeps about bookings, cars and managers.' }),
		chapter('printing', 'Printing', body('paper'), { purpose: 'What is printed.' }),
		chapter('archive', 'Archiving', body('old paper'), { purpose: 'What is archived.' })
	];
	const bigRules = big.map((c, i) => rule(`REQ-0${i + 10}`, c.key, `A rule of ${c.title}.`));
	const roomy = documentContext(big, bigRules, big[2]);
	check('a long document is shown whole while it fits', [...roomy.shown.values()].every((s) => s === 'full'), true);
	const tight = documentContext(big, bigRules, big[2], 9000);
	check('past its room, it fits', tight.text.length <= 9000, true);
	check('the least related chapters lose detail first, the Overview last',
		[tight.shown.get('printing') !== 'full', tight.shown.get('archive') !== 'full', tight.shown.get('overview')], [true, true, 'full']);
	check('every chapter is still named, and every rule still there',
		[big.filter((c) => c.key !== 'data').every((c) => tight.text.includes(`(key: ${c.key})`)), ['REQ-010', 'REQ-011', 'REQ-013', 'REQ-014'].every((ref) => tight.text.includes(ref))], [true, true]);
	check('a chapter shown in part says how', /\[(outline|rules only|title only)\]/.test(tight.text), true);
	const squeezed = documentContext(big, bigRules, big[2], 400);
	check('and with almost no room, chapters fall to their titles rather than being dropped',
		[squeezed.shown.get('printing'), squeezed.text.includes('## Printing (key: printing) [title only]')], ['title', true]);
	check('related by what the chapter under discussion is for, and its family above all',
		[relatedness(big[2], big[1]) > relatedness(big[2], big[3]), relatedness(big[2], big[0]), relatedness(big[2], chapter('x', 'X', '', { parent_key: 'data' })) > 1000], [true, Infinity, true]);

	check('an outline keeps the headings and the first sentence of each paragraph',
		outlineOf('## Cars\n\nEach car has a plate. It also has a size.\n\nRetired cars stay listed.\n\n- plate\n- size\n- fuel'),
		'## Cars\nEach car has a plate. …\nRetired cars stay listed.\n- plate (… 2 more)');
	check('and leaves out code', outlineOf('Before.\n\n```\n## not a heading\n\nstill code\n```\n\nAfter.'), 'Before.\nAfter.');

	const read = readChapter({ key: 'users-and-roles' }, big, bigRules);
	check('a chapter read is the whole of it, with its rules', [read.chapter?.key, read.text.includes('part 11 begins'), read.text.includes('REQ-011')], ['users-and-roles', true, true]);
	check('or one part of it, by heading', readChapter({ key: 'printing', heading: 'about paper' }, big, bigRules).text.startsWith('## Printing (key: printing) — About paper\nThe paper part 0'), true);
	check('by title as well as by key', readChapter({ key: 'Users and Roles' }, big, bigRules).chapter?.key, 'users-and-roles');
	check('a key that is not there says which are',
		[readChapter({ key: 'nope' }, big, bigRules).chapter, readChapter({ key: 'nope' }, big, bigRules).text.includes('overview, users-and-roles')], [null, true]);
	check('a heading that is not there says which are', readChapter({ key: 'printing', heading: 'Ink' }, big, bigRules).text.includes('Its headings are: About paper'), true);
	check('the read tool asks for a key and nothing long', [READ_TOOL.name, READ_TOOL.input_schema.required], ['read_chapter', ['key']]);

	const state = buildTurnState({ chapters, active: chapters[2], activeRequirements: [rules[1]], message: '  Managers only see totals.  ' });
	const at = (text) => state.indexOf(text);
	check('the turn carries the chapter as it reads now, its rules and what is open',
		[state.includes('Bookings keep who'), state.includes('REQ-002'), state.includes('How long are bookings kept?'), state.includes('is currently "in_progress"')],
		[true, true, true, true]);
	check('the colleague\'s message after the state, and the checklist last of all',
		[at('WHERE THIS CHAPTER STANDS NOW') < at('Managers only see totals.'), at('Managers only see totals.') < at('CHECK ALL OF THIS')], [true, true]);
	check('the checklist asks for a contradiction with another chapter to be corrected in the same reply, and said',
		[state.includes('contradicts another chapter'), state.includes('correct\n   that chapter in the same reply'), state.includes('what it said before')], [true, true, true]);
	check('the company standards note only when one applies',
		[state.includes('[company standard]'), buildTurnState({ chapters, active: chapters[2], activeRequirements: [rule('REQ-009', 'data', 'Logs kept a year.', 'standard')], message: 'x' }).includes('do not interview the user about them')],
		[false, true]);
	const whole = buildTurnState({ chapters, active: null, activeRequirements: [], message: 'What is missing?' });
	check('the whole-document conversation gets where things stand, and no chapter checklist',
		[whole.includes('> [') , whole.includes('CHECK ALL'), whole.endsWith('What is missing?')], [false, false, true]);

	// As the live gateway replied once on 2026-10-03, with no block at all.
	const claimed = 'I changed "Users and roles", which said managers see every booking, and tightened Reporting.';
	check('a reply naming chapters it did not write is noticed, by title, ignoring case',
		unwrittenMentions(claimed.toLowerCase(), chapters, [], 'data').map((c) => c.key), ['users-and-roles', 'reporting']);
	check('a chapter it did write is not', unwrittenMentions(claimed, chapters, ['users-and-roles'], 'data').map((c) => c.key), ['reporting']);
	check('nor the chapter under discussion, a set-aside one, or a reply naming none',
		[unwrittenMentions('Data is fine. Integrations too.', chapters, [], 'data').length, unwrittenMentions('All recorded.', chapters, [], 'data').length], [0, 0]);
	const repair = repairRequest([chapters[1]]);
	check('the follow-up names the chapter by key, asks for blocks only, and allows nothing',
		[repair.includes('(key: users-and-roles)'), repair.includes('nothing else: no reply'), repair.includes('send nothing at all')], [true, true, true]);

	const conversation = [{ role: 'user', content: 'Earlier.' }, { role: 'assistant', content: 'Asked.' }, { role: 'user', content: 'Answer.' }];
	const sent = withLastTurn(conversation, 'WRAPPED');
	check('only the last turn of the request is wrapped', sent.map((m) => m.content), ['Earlier.', 'Asked.', 'WRAPPED']);
	check('and what is stored is left as it was said', conversation[2].content, 'Answer.');
	check('a conversation ending with the assistant gets the wrapped turn added',
		withLastTurn([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }], 'W').map((m) => m.role), ['user', 'assistant', 'user']);

	check('the window keeps everything until it passes sixteen', [0, 5, 16].map((n) => historyWindowStart(n)), [0, 0, 0]);
	check('then starts on a multiple of eight, keeping sixteen to twenty-three',
		[17, 23, 24, 25, 31, 32, 40].map((n) => historyWindowStart(n)), [0, 0, 8, 8, 8, 16, 24]);
	const starts = Array.from({ length: 40 }, (_, turn) => historyWindowStart(16 + 2 * turn));
	check('so its start stays put for four turns at a time, not moving every turn',
		starts.slice(0, 12), [0, 0, 0, 0, 8, 8, 8, 8, 16, 16, 16, 16]);
	// A long chapter, edited a part at a time.
	const longText = `Intro line.\n\n## Cars\n\nEach car has a plate.\n\n### Detail\n\nDeep.\n\n## Bookings\n\nA booking names a car.   \nKept as typed.\n\n## Returns\n\nMileage noted.`;
	check('a chapter is cut at its shallowest headings, deeper ones staying inside',
		[chapterParts(longText).sections.map((s) => s.heading), chapterParts(longText).sections[0].body.includes('### Detail'), chapterParts(longText).preamble], [['Cars', 'Bookings', 'Returns'], true, 'Intro line.']);
	const replaced = mergeSection(longText, 'cars', 'Each car has a plate and a size.');
	check('a part is replaced by its heading, as a reader would match it',
		[replaced.outcome, replaced.markdown.includes('## Cars\n\nEach car has a plate and a size.\n\n## Bookings'), replaced.markdown.includes('Deep.')], ['replaced', true, false]);
	check('and every other part is kept exactly as written, trailing spaces and all',
		replaced.markdown.includes('A booking names a car.   \nKept as typed.') && replaced.markdown.startsWith('Intro line.\n\n## Cars'), true);
	check('a new heading is added at the end, at the chapter\'s level',
		[mergeSection(longText, 'Damage', 'Reported at the desk.').outcome, mergeSection(longText, 'Damage', 'Reported at the desk.').markdown.endsWith('Mileage noted.\n\n## Damage\n\nReported at the desk.')], ['added', true]);
	check('the text before the first heading is the part with no heading',
		mergeSection(longText, '', 'New intro.').markdown.startsWith('New intro.\n\n## Cars'), true);
	check('a part can be removed, and removing one that is not there changes nothing',
		[mergeSection(longText, 'Bookings', '', true).markdown.includes('Bookings'), mergeSection(longText, 'Ink', '', true).outcome], [false, 'unchanged']);
	check('an empty part erases nothing', mergeSection(longText, 'Cars', '   ').outcome, 'unchanged');
	check('a part that repeats its own heading has it taken off', mergeSection(longText, 'Returns', '## Returns\n\nMileage and lateness noted.').markdown.endsWith('## Returns\n\nMileage and lateness noted.'), true);
	check('numbering, emphasis and end punctuation do not stop a heading matching',
		[sameHeading('2. **Bookings**:', 'bookings'), sameHeading('Bookings', 'Booking')], [true, false]);
	check('a chapter with no headings divides at level two when one is added',
		mergeSection('Just prose.', 'Cars', 'Plates.').markdown, 'Just prose.\n\n## Cars\n\nPlates.');
	check('a heading inside a code example is not a part', chapterParts('Text.\n\n```\n## Not one\n```\n\n## Real\n\nYes.').sections.map((s) => s.heading), ['Real']);

	const longChapter = chapter('data', 'Data', `Intro.\n\n## Cars\n\n${'Car detail. '.repeat(400)}\n\n## Bookings\n\n${'Booking detail. '.repeat(200)}`);
	const longState = buildTurnState({ chapters, active: longChapter, activeRequirements: [], message: 'Cars also have a colour.' });
	check('a long chapter is asked for the parts that change, not rewritten whole',
		[longChapter.content_md.length > LONG_CHAPTER, longState.includes('do NOT rewrite it whole'), longState.includes('<section chapter="data" heading="Cars">'), longState.includes('- Bookings')],
		[true, true, true, true]);
	check('a short one is still rewritten whole', [state.includes('<chapter key="data"> block carrying the whole chapter'), state.includes('<section chapter="data"')], [true, false]);
	const unheaded = buildTurnState({ chapters, active: chapter('data', 'Data', 'Prose. '.repeat(1200)), activeRequirements: [], message: 'x' });
	check('a long chapter with no headings is rewritten once, under headings', unheaded.includes('organise it\n   under ## headings'), true);
	const huge = chapter('data', 'Data', `## Cars\n\n${'First sentence here. And then much more. '.repeat(1200)}`);
	const hugeState = buildTurnState({ chapters, active: huge, activeRequirements: [], message: 'x' });
	check('a chapter too long to show is shown as its outline, to be read a part at a time',
		[huge.content_md.length > ACTIVE_LIMIT, hugeState.length < 8000, hugeState.includes('read_chapter, key "data"')], [true, true, true]);

	check('and never replays fewer than sixteen or more than twenty-three',
		Array.from({ length: 200 }, (_, n) => n - historyWindowStart(n)).every((kept, n) => kept === n || (kept >= HISTORY_KEEP && kept < HISTORY_KEEP + HISTORY_STEP)), true);
}

console.log('\n--- reading a chapter, writing a part of one ---');

{
	const parser = new ChapterStreamParser();
	const visible = parser.push('<section chapter="data" heading="Cars">Plates and sizes.</section>Recorded.');
	parser.end();
	check('a section block is taken out of the chat and kept as a block, not as the whole chapter',
		[visible.trim(), parser.blocksOf('section')[0]?.attrs, parser.blocksOf('section')[0]?.body, parser.drafts.size],
		['Recorded.', { chapter: 'data', heading: 'Cars' }, 'Plates and sizes.', 0]);

	const progress = new TurnProgress(() => 0);
	const writingPart = progress.observe({ index: 0, tag: 'section', attrs: { chapter: 'data' }, body: 'Plates' }, [], false, (a) => a.chapter);
	check('a part being written is said to be written, but not shown as the chapter',
		[writingPart.activity, writingPart.drafts.length], [{ doing: 'writing', chapter: 'data' }, 0]);
	check('reading is said in the same terms', progress.announce('reading', 'security'), { doing: 'reading', chapter: 'security' });
	check('and once the model writes again, the chat stops saying it reads',
		progress.observe(null, [], false, () => null).activity, { doing: 'thinking', chapter: null });
	check('the chat names the chapter being read', [describeActivity({ doing: 'reading', chapter: 'security' }, 'Security'), describeActivity({ doing: 'reading', chapter: null }, null)],
		['Reading “Security”…', 'Reading the document…']);

	check('a streamed tool call\'s arguments are put together, and nonsense is an empty call',
		[toolInput('{"key": "security"}'), toolInput(''), toolInput('{"key": "sec'), toolInput('[1]')], [{ key: 'security' }, {}, {}, {}]);
	check('a turn that read is plain text for a model that cannot take tool calls',
		textOf([{ type: 'text', text: 'Let me check.' }, { type: 'tool_use', id: 't1', name: 'read_chapter', input: { key: 'security' } }]),
		'Let me check.\n\n(read_chapter {"key":"security"})');
	check('and what it read is the text it was given', textOf([{ type: 'tool_result', tool_use_id: 't1', content: '## Security\nKept a year.' }]), '## Security\nKept a year.');
	check('a plain turn stays as it is', textOf('Hello.'), 'Hello.');
}

console.log('\n--- showing the writing as it happens ---');

{
	const parser = new ChapterStreamParser();
	parser.push('<chapter key="overview">\n# Overview\n\nFleet cars are booked');
	check('an open chapter is visible while it is written', [parser.writing.tag, parser.writing.attrs.key, parser.writing.index], ['chapter', 'overview', 0]);
	check('without the characters that might begin its closing tag',
		parser.writing.body.endsWith('booked'), false);
	check('but with what is safely written', parser.writing.body.includes('# Overview'), true);
	parser.push(' by staff.</chapter>');
	check('between blocks nothing is being written', parser.writing, null);
	parser.push('<requirement scope="now">Cars');
	check('the next block has the next place', parser.writing.index, 1);
}

{
	let now = 0;
	const progress = new TurnProgress(() => now);
	const key = (attrs) => (attrs.key === 'nowhere' ? null : attrs.key || 'overview');
	const open = (index, tag, body, attrs = {}) => ({ index, tag, attrs, body });

	let update = progress.observe(open(0, 'chapter', 'Fleet', { key: 'overview' }), [], false, key);
	check('opening a chapter says which one is being written', update.activity, { doing: 'writing', chapter: 'overview' });
	check('and sends what is there at once', update.drafts, [{ chapter: 'overview', delta: 'Fleet' }]);

	now += DRAFT_EVERY_MS - 1;
	update = progress.observe(open(0, 'chapter', 'Fleet cars', { key: 'overview' }), [], false, key);
	check('more text within the interval waits', [update.activity, update.drafts], [undefined, []]);
	now += 1;
	update = progress.observe(open(0, 'chapter', 'Fleet cars are', { key: 'overview' }), [], false, key);
	check('and is sent as only what is new', update.drafts, [{ chapter: 'overview', delta: ' cars are' }]);

	update = progress.observe(null, [{ tag: 'chapter', body: 'Fleet cars are booked.' }], false, key);
	check('a closed chapter is sent whole, as it will be saved', update.drafts, [{ chapter: 'overview', markdown: 'Fleet cars are booked.' }]);
	check('and between blocks the assistant is thinking', update.activity, { doing: 'thinking', chapter: null });

	update = progress.observe(open(1, 'requirement', 'Cars'), [{ tag: 'chapter', body: '' }], false, key);
	check('a rule being written is noted, not sent', [update.activity, update.drafts], [{ doing: 'noting', chapter: null }, []]);

	update = progress.observe(null, [{ tag: 'chapter', body: '' }, { tag: 'requirement', body: 'Cars' }], true, key);
	check('the reply is the reply', update.activity, { doing: 'replying', chapter: null });
	update = progress.observe(null, [{ tag: 'chapter', body: '' }, { tag: 'requirement', body: 'Cars' }], false, key);
	check('and a pause in it is still the reply', update.activity, undefined);

	const lost = new TurnProgress(() => now);
	update = lost.observe(open(0, 'chapter', 'Text', { key: 'nowhere' }), [], false, key);
	check('a chapter that cannot be placed is still named as writing', update.activity, { doing: 'writing', chapter: null });
	check('but nothing of it reaches a chapter it may not belong to', update.drafts, []);
}

{
	check('the chat says which chapter is being written, and how far', describeActivity({ doing: 'writing', chapter: 'overview' }, 'Overview', 420),
		'Writing “Overview” — 420 words so far…');
	check('before any words, no count', describeActivity({ doing: 'writing', chapter: 'overview' }, 'Overview', 0), 'Writing “Overview”…');
	check('a chapter without a title is still being written', describeActivity({ doing: 'writing', chapter: null }, null, 1), 'Writing the chapter — 1 word so far…');
	check('before anything, thinking', describeActivity(null, null), 'Thinking…');
	check('the second call has its own words', describeActivity({ doing: 'checking', chapter: 'overview' }, 'Overview'), 'Checking what is still open…');
	check('as does the commit', describeActivity({ doing: 'saving', chapter: null }, null), 'Saving to the history…');
	check('markdown marks are not words', wordCount('# Overview\n\n- Fleet cars — booked by *staff*.\n'), 6);
}

console.log('\n--- drafting a whole document ---');
{
	const chapter = (key, extra = {}) => ({
		key, title: key[0].toUpperCase() + key.slice(1), goal: '', purpose: `Purpose of ${key}`,
		questions: [`Question about ${key}?`], criteria: [`${key} is settled`],
		applicable: 1, parent_key: '', content_md: '', ...extra
	});
	const chapters = [
		chapter('users'),
		chapter('overview'),
		chapter('security', { applicable: 0 }),
		chapter('functionality'),
		chapter('booking', { parent_key: 'functionality' }),
		chapter('data', { content_md: 'Written by someone.' }),
		chapter('telemetry'),
		chapter('operations'),
		chapter('integration')
	];
	const holdings = new Map([
		['telemetry', { messages: 1, decisions: 0, rules: 0 }],
		['operations', { messages: 0, decisions: 1, rules: 0 }],
		['integration', { messages: 0, decisions: 0, rules: 1 }]
	]);
	check('a draft writes the Overview first, then what applies, in document order',
		chaptersToDraft(chapters, holdings).map((c) => c.key), ['overview', 'users', 'booking']);
	check('a chapter holding only company standards is still drafted',
		chaptersToDraft([chapter('licenses')], new Map([['licenses', { messages: 0, decisions: 0, rules: 0 }]])).length, 1);

	const evidence = { origin: 'generated', documentRevision: 7, draftedRevision: 7, userMessages: 0, reviewed: 0 };
	check('a draft nobody has touched is untouched', isUntouchedDraft(evidence), true);
	check('a write since the draft left it touches it', isUntouchedDraft({ ...evidence, documentRevision: 8 }), false);
	check('so does an answer that changed nothing', isUntouchedDraft({ ...evidence, userMessages: 1 }), false);
	check('so does an approval', isUntouchedDraft({ ...evidence, reviewed: 1 }), false);
	check('an interview is never an untouched draft', isUntouchedDraft({ ...evidence, origin: 'interview' }), false);
	check('nor is a draft that never recorded where it stopped', isUntouchedDraft({ ...evidence, draftedRevision: null }), false);

	const state = (over) => draftState({ origin: 'generated', running: false, remaining: 0, written: 3, untouched: true, ...over });
	check('an interview has no draft state', state({ origin: 'interview', remaining: 3 }), null);
	check('a running draft is running whatever is left', state({ running: true, remaining: 4, written: 0 }), 'running');
	check('an untouched draft with chapters left stopped', state({ remaining: 2 }), 'stopped');
	check('a touched draft with chapters left has undrafted chapters, not a stopped draft',
		state({ remaining: 2, untouched: false }), 'undrafted');
	check('a draft that wrote nothing at all is empty', state({ remaining: 5, written: 0 }), 'empty');
	check('a draft with nothing left finished, touched or not',
		[state({}), state({ untouched: false })], ['finished', 'finished']);
	check('a chapter the draft wrote is never left without an assumption to check',
		[UNCHECKED_CHAPTER.statement.length > 0, UNCHECKED_CHAPTER.rationale.length > 0], [true, true]);

	const prompt = buildDraftPrompt({
		project: { name: 'Pool cars', description: 'Rezervace služebních aut na den', kind: 'change' },
		profile: 'used across Škoda Auto; holds personal data',
		chapter: chapter('security', { goal: 'Name what could go wrong.' }),
		chapters: [{ key: 'overview', title: 'Overview', goal: 'Say what it is for.' }],
		overview: 'Employees book pool cars.',
		decidedElsewhere: [{ chapter: 'Users and roles', statement: 'Only the fleet office can block a car.' }],
		standards: ['Data is encrypted at rest.']
	});
	check('the drafting prompt carries the description, the chapter and its questions',
		['Rezervace služebních aut na den', 'Question about security?', 'security is settled'].every((s) => prompt.includes(s)), true);
	check('it carries the Overview and what other chapters decided',
		[prompt.includes('Employees book pool cars.'), prompt.includes('Only the fleet office can block a car.')], [true, true]);
	check('it lists the standards not to restate', prompt.includes('Data is encrypted at rest.'), true);
	check('an existing application is drafted as one', prompt.includes('IT ALREADY EXISTS') && prompt.includes('existing="true"'), true);
	check('the Overview is not handed to itself',
		buildDraftPrompt({ project: { name: 'X', description: 'Y', kind: 'new' }, profile: 'p', chapter: chapter('overview'),
			chapters: [], overview: 'Old overview text', decidedElsewhere: [], standards: [] }).includes('Old overview text'), false);
	check('a retry is told its last attempt did not finish, and a first attempt is not',
		[buildDraftPrompt({ project: { name: 'X', description: 'Y', kind: 'new' }, profile: 'p', chapter: chapter('users'),
			chapters: [], overview: '', decidedElsewhere: [], standards: [], brief: true }).includes('DID NOT FINISH'),
		prompt.includes('DID NOT FINISH')], [true, false]);
	check('the request names the chapter', draftRequest('Security'), 'Draft the chapter "Security" now.');

	const drafts = (...entries) => new Map(entries);
	check('prose named by key is this chapter\'s', draftedProse({ key: 'security', title: 'Security' },
		drafts(['', 'unkeyed'], ['security', 'keyed'])), 'keyed');
	check('prose with no key is this chapter\'s', draftedProse({ key: 'security', title: 'Security' }, drafts(['', 'unkeyed'])), 'unkeyed');
	check('prose named by title is this chapter\'s', draftedProse({ key: 'security', title: 'Security' }, drafts([' security ', 'titled'])), 'titled');
	check('prose for another chapter is nobody\'s', draftedProse({ key: 'security', title: 'Security' }, drafts(['overview', 'elsewhere'])), null);
	check('an empty block is no prose', draftedProse({ key: 'security', title: 'Security' }, drafts(['security', '  \n'])), null);
	const withoutHeading = (markdown) => markdown.replace(/^\s*#+\s*Security\s*$/m, '').trim();
	check('a block that is only its own heading is no prose',
		draftedProse({ key: 'security', title: 'Security' }, drafts(['security', '## Security\n']), withoutHeading), null);
	check('the prose kept is the normalised prose',
		draftedProse({ key: 'security', title: 'Security' }, drafts(['security', '# Security\n\nOnly staff sign in.']), withoutHeading),
		'Only staff sign in.');

	check('a drafted rule is filed here, as new',
		asDraftBlock({ tag: 'requirement', attrs: { chapter: 'overview', ref: 'REQ-001', scope: 'later', existing: 'true' }, body: 'Rule' }),
		{ tag: 'requirement', attrs: { scope: 'later', existing: 'true' }, body: 'Rule' });
	check('a drafted removal is not a block', asDraftBlock({ tag: 'requirement', attrs: { ref: 'REQ-001', action: 'remove' }, body: '' }), null);
	check('a decision labelled the user\'s is the assistant\'s',
		asDraftBlock({ tag: 'decision', attrs: { source: 'user', chapter: 'overview' }, body: 'Choice' }),
		{ tag: 'decision', attrs: { source: 'agent' }, body: 'Choice' });
	check('options and section plans are not the draft\'s to write',
		[asDraftBlock({ tag: 'options', attrs: {}, body: 'A' }), asDraftBlock({ tag: 'subchapters', attrs: {}, body: 'a: A' })], [null, null]);
}

/* --- the mock-up ------------------------------------------------------------- */

{
	const chapter = (key, content_md, extra = {}) => ({ key, title: key[0].toUpperCase() + key.slice(1), applicable: 1, parent_key: '', content_md, ...extra });
	const project = { name: 'Pool cars', description: 'Book a pool car for a day.' };
	const rule = (chapter_key, statement, scope = 'now') => ({ chapter_key, statement, scope });

	check('nothing written is nothing to make a mock-up from',
		mockupDocument(project, [chapter('overview', '  '), chapter('users', '')], [rule('overview', 'A rule')]), '');
	check('prose only in a set-aside chapter is still nothing',
		mockupDocument(project, [chapter('overview', ''), chapter('telemetry', 'Counted.', { applicable: 0 })], []), '');

	const document = mockupDocument(project, [
		chapter('overview', 'Employees book cars.'),
		chapter('functionality', 'What it does.'),
		chapter('booking', 'Pick a car and a day.', { parent_key: 'functionality' }),
		chapter('telemetry', 'Counted.', { applicable: 0 }),
		chapter('licenses', '')
	], [
		rule('booking', 'Two people never book the same car on the same day.'),
		rule('booking', 'Cars can be booked a year ahead.', 'later'),
		rule('booking', 'No electric cars.', 'out'),
		rule('telemetry', 'Every click is counted.')
	]);
	check('the document is given in the order given, sections under their chapter',
		['# Pool cars', 'Book a pool car', '## Overview', '## Functionality', '### Booking'].map((s) => document.indexOf(s)).every((at, i, all) => at >= 0 && (i === 0 || at > all[i - 1])), true);
	check('with the rules for the first version', document.includes('- Two people never book the same car on the same day.'), true);
	check('and none for later or out of scope', [document.includes('a year ahead'), document.includes('electric')], [false, false]);
	check('a set-aside chapter is left out, and its rules with it', [document.includes('Telemetry'), document.includes('Every click')], [false, false]);
	check('an empty chapter adds no heading', document.includes('Licenses'), false);

	const long = mockupDocument(project, [chapter('overview', 'word '.repeat(2000))], []);
	check('long prose is clipped at a word, and says so',
		[long.length < PROSE_LIMIT + 200, long.trimEnd().endsWith('word […]')], [true, true]);
	const sprawling = mockupDocument(project,
		Array.from({ length: 40 }, (_, i) => chapter(`chapter-${i}`, 'word '.repeat(2000))), []);
	check('a document of many chapters shares the prose out, every chapter still there',
		[sprawling.length < DOCUMENT_PROSE_LIMIT * 1.2, (sprawling.match(/^## /gm) ?? []).length], [true, 40]);
	const many = mockupDocument(project, [chapter('overview', 'Text.')],
		Array.from({ length: RULES_PER_CHAPTER + 5 }, (_, i) => rule('overview', `Rule ${i}.`)));
	check('at most so many rules a chapter', (many.match(/^- Rule/gm) ?? []).length, RULES_PER_CHAPTER);

	const prompt = buildMockupPrompt();
	check('the prompt asks for one self-contained page with nothing from outside',
		[prompt.includes('<!DOCTYPE html>'), /no external script/i.test(prompt), /no build step/i.test(prompt), /no code fence/i.test(prompt)],
		[true, true, true, true]);
	check('in the document\'s language, with a switcher for different users',
		[/language the document is written in/.test(prompt), /viewing as/i.test(prompt)], [true, true]);
	check('and keeping changes in memory, not in storage the sandbox takes away', /do not use localStorage/i.test(prompt), true);
	check('and compact from the first attempt, with the reason', /around 20 to 30 KB/.test(prompt) && /does not finish/.test(prompt), true);
	check('the second attempt asks for something smaller and self-contained',
		[buildMockupPrompt(true).includes('COULD NOT BE USED'), prompt.includes('COULD NOT BE USED')], [true, false]);
	check('the request carries the document', mockupRequest('# Pool cars').startsWith('# Pool cars'), true);

	const deciding = buildScreensPrompt();
	check('the first call decides the screens, as a short list between tags and no page',
		[deciding.includes('<screens>'), /at most six/.test(deciding), /no\s+HTML/.test(deciding), /language the\s+document is written in/.test(deciding)],
		[true, true, true, true]);
	check('and is given the document', screensRequest('# Pool cars').startsWith('# Pool cars'), true);
	check('the screens are read from between the tags, without the talk around them',
		extractScreens('Here they are.\n<screens>\n1. Bookings\n2. Cars\n</screens>\nDone.'), '1. Bookings\n2. Cars');
	check('a list without its tags is still the list', extractScreens('1. Bookings\n2. Cars\n'), '1. Bookings\n2. Cars');
	check('a list whose closing tag never came runs to the end', extractScreens('<screens>\n1. Bookings'), '1. Bookings');
	check('a reply with nothing in it decides nothing', [extractScreens('  \n'), extractScreens('<screens>\n</screens>')], [null, null]);
	check('a long list is clipped', extractScreens('word '.repeat(SCREENS_LIMIT)).length <= SCREENS_LIMIT + 4, true);

	const planned = buildMockupPrompt(false, true);
	check('given the screens, the page call is told they are decided and to write at once',
		[/already decided/.test(planned), /Start\s+writing it at once/.test(planned), /already decided/.test(prompt), /at once/.test(prompt)],
		[true, true, false, false]);
	check('and is still asked for the document\'s language and a whole page',
		[/language the document is written in/.test(planned), planned.includes('<!DOCTYPE html>')], [true, true]);
	const withScreens = mockupRequest('# Pool cars', '1. Bookings');
	check('the page call is given the screens after the document',
		[withScreens.startsWith('# Pool cars'), withScreens.indexOf('1. Bookings') > withScreens.indexOf('# Pool cars')], [true, true]);
	check('and without them is asked as before', mockupRequest('# Pool cars', null), mockupRequest('# Pool cars'));

	const page = '<!DOCTYPE html>\n<html lang="en">\n<head><style>body{margin:0}</style></head>\n<body><main>Hi</main><script>1</script></body>\n</html>';
	check('a bare page is the page', extractMockup(page), page);
	check('a code fence and talk around it are dropped',
		extractMockup(`Here is your mock-up:\n\n\`\`\`html\n${page}\n\`\`\`\n\nEnjoy!`), page);
	check('a doctype mentioned in a sentence first is not the start',
		extractMockup(`I will begin with <!DOCTYPE html> and inline CSS.\n\`\`\`html\n${page}\n\`\`\``), page);
	check('a page with no doctype starts at its opening tag',
		extractMockup('Sure.\n<html><body>Hi</body></html>\nDone.'), '<html><body>Hi</body></html>');
	check('a page with no closing tag ends at the fence',
		extractMockup('```html\n<!doctype html>\n<body>Hi\n```\nThat is all.'), '<!doctype html>\n<body>Hi');
	check('or after its body, so talk after it is not shown as page text',
		extractMockup('<!doctype html>\n<body>Hi</body>\nI hope this helps!'), '<!doctype html>\n<body>Hi</body>\n</html>');
	check('no page in the reply is none', extractMockup('I could not make one.'), null);
	check('markup with no body is not a page', extractMockup('<!DOCTYPE html><html><head></head></html>'), null);
	check('Windows line endings are read the same', extractMockup(page.replace(/\n/g, '\r\n')), page);

	const outside = '<!DOCTYPE html><html><head>' +
		'<script src="https://cdn.tailwindcss.com"></script>' +
		'<link rel="stylesheet" href="//fonts.example.com/inter.css">' +
		'<link rel="preconnect" href="https://fonts.example.com">' +
		'<link rel="icon" href="https://example.com/favicon.ico">' +
		'<style>@import url("https://example.com/base.css");</style>' +
		'<script src="data:text/javascript,1"></script>' +
		'<script src=app.js></script>' +
		'</head><body><img src="https://example.com/car.png"></body></html>';
	check('scripts and stylesheets from outside the file are found, wherever they come from',
		loadsFromOutside(outside), ['https://cdn.tailwindcss.com', 'app.js', 'https://example.com/base.css']);
	check('a typeface from outside is not counted: the page falls back to the system\'s',
		loadsFromOutside('<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">'), []);
	check('a page that carries everything loads nothing from outside', loadsFromOutside(page), []);
	check('the retry is spent on no page, or a page that loads from outside',
		[worthAnotherTry(null), worthAnotherTry(outside), worthAnotherTry(page)], [true, true, false]);
	const smaller = '<!DOCTYPE html><html><body>Smaller</body></html>';
	const alsoOutside = '<!DOCTYPE html><html><head><script src="https://cdn.example.com/x.js"></script></head><body>Second</body></html>';
	check('of two attempts, the second when the first had no page or it loads less from outside',
		[betterMockup(null, smaller), betterMockup(outside, smaller), betterMockup(outside, null)], [smaller, smaller, outside]);
	check('and the fuller first one when the second is no better',
		[betterMockup(outside, outside.replace('Hi', 'Again')), betterMockup(alsoOutside, outside)], [outside, alsoOutside]);

	const kept = prepareMockup(page, { name: 'Pool --> cars <script>', madeOn: '2026-10-03' });
	check('the doctype stays first, the note right after it', kept.startsWith('<!DOCTYPE html>\n<!--'), true);
	check('the note says what the file is, and when', [kept.includes('A mock-up of "Pool - cars script"'), kept.includes('2026-10-03'), /design document, not\s+this page, is what to build from/.test(kept)], [true, true, true]);
	check('nothing in the name ends the note early', (kept.match(/-->/g) ?? []).length, 1);
	const head = kept.slice(kept.indexOf('<head>'), kept.indexOf('</head>'));
	check('the head starts with the encoding, the file\'s policy, a viewport and the stand-ins',
		[head.indexOf('<meta charset="utf-8">') > 0, head.includes(`content="${MOCKUP_FILE_POLICY}"`), head.includes('name="viewport"'), head.includes('window.alert = ')], [true, true, true, true]);
	check('ahead of anything of the page\'s own', head.indexOf('window.alert') < head.indexOf('<style>body{margin:0}'), true);
	check('the page itself follows unchanged', kept.endsWith('<style>body{margin:0}</style></head>\n<body><main>Hi</main><script>1</script></body>\n</html>'), true);
	check('a page with its own viewport keeps it, and gets no second',
		(prepareMockup('<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"></head><body></body></html>', { name: 'A', madeOn: 'x' })
			.match(/name="viewport"/g) ?? []).length, 1);
	const bare = prepareMockup('<body>Hi</body>', { name: 'A', madeOn: 'x' });
	check('a page with no doctype or head is given both, never quirks mode',
		[bare.startsWith('<!DOCTYPE html>\n<!--'), /<head>\n<meta charset="utf-8">/.test(bare), bare.endsWith('<body>Hi</body>')], [true, true, true]);
	const noHead = prepareMockup('<!doctype html><html lang="cs"><body>Ahoj</body></html>', { name: 'A', madeOn: 'x' });
	check('a page with no head gets one inside its html element', /<html lang="cs">\n<head>\n<meta charset/.test(noHead), true);
	check('a header element is not mistaken for the head',
		prepareMockup('<!doctype html><html><body><header>Top</header></body></html>', { name: 'A', madeOn: 'x' }).indexOf('<header>Top</header>') >
		prepareMockup('<!doctype html><html><body><header>Top</header></body></html>', { name: 'A', madeOn: 'x' }).indexOf('<meta charset'), true);

	check('the sandbox never gives the page Specman\'s origin, the top window, popups, dialogs or downloads',
		['allow-same-origin', 'allow-top-navigation', 'allow-popups', 'allow-modals', 'allow-downloads'].some((flag) => MOCKUP_SANDBOX.includes(flag)), false);
	check('the file carries the same limits, without what has no effect inside a page',
		[MOCKUP_POLICY.includes(MOCKUP_FILE_POLICY), /sandbox|frame-ancestors/.test(MOCKUP_FILE_POLICY), MOCKUP_FILE_POLICY.includes(`connect-src 'none'`)], [true, false, true]);
	check('it is answered to its frame, and to a browser that does not say, but not as a page of its own',
		[forTheFrame('iframe'), forTheFrame(null), forTheFrame('document'), forTheFrame('embed')], [true, true, false, false]);
	const gates = Array.from({ length: 4 }, () => {
		let open;
		const shut = new Promise((resolve) => (open = resolve));
		return { open, shut };
	});
	const held = gates.map((gate) => longCalls.run(() => gate.shut));
	check('mock-ups and drafted chapters share three places across the installation', [longCalls.busy, longCalls.waiting], [3, 1]);
	gates.forEach((gate) => gate.open());
	await Promise.all(held);
	const directives = new Map(MOCKUP_POLICY.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values.join(' ')]));
	check('the policy sandboxes it, as the frame does', directives.get('sandbox'), MOCKUP_SANDBOX);
	check('and allows nothing but itself: no fetch, no form, no other source',
		[directives.get('default-src'), directives.get('connect-src'), directives.get('form-action'), directives.get('base-uri'), directives.get('script-src')],
		["'none'", "'none'", "'none'", "'none'", "'unsafe-inline'"]);
	check('and only Specman may frame it', [directives.get('frame-ancestors'), mockupHeaders()['x-frame-options']], ["'self'", 'SAMEORIGIN']);
	check('every response carrying it sends the policy, and is never cached',
		[mockupHeaders()['content-security-policy'], mockupHeaders()['cache-control'], mockupHeaders()['x-content-type-options']], [MOCKUP_POLICY, 'no-store', 'nosniff']);
	check('the file is named for the application', [mockupFileName('pool-cars'), mockupFileName('"; x'), mockupFileName('')],
		['pool-cars-mock-up.html', 'x-mock-up.html', 'application-mock-up.html']);
}

console.log('\n--- the business and technical overview ---');

{
	// The shape the served models write: talk around it, a fence, a table header
	// in the work, Czech prose, a size as a word, a service not in the list, and
	// the last section's closing tag dropped.
	const reply = `Here is the overview.

\`\`\`
<pitch>
Rezervace služebních aut na jednom místě. Zaměstnanci si auto zarezervují sami a fleet office vidí obsazenost.
</pitch>

<business-case>
## Problém
Dnes se rezervuje e-mailem.
- méně e-mailů
- **přehled** o vytížení
</business-case>

<business-complexity level="medium">
Tři skupiny uživatelů.
</business-complexity>

<technical-complexity>
High: napojení na SAP a na docházku.
</technical-complexity>

<work>
Part | Person-days
---|---
Rezervační formulář | 8
- Přehled obsazenosti: 5 days
Napojení na SAP | 3-5
Správa | 1,5
Migrace | 1000
Nothing to count here
</work>

<azure>
service | size | why
app-service | m | dva uzly kvůli dostupnosti
sql | small | rezervace
sql | l |
SAP connector | - | napojení
monitoring | s
</azure>

<assumptions>
- Asi 300 uživatelů.
\`\`\``;
	const read = extractOverview(reply);
	check('the pitch is read without the talk around it', read.pitch.startsWith('Rezervace služebních aut'), true);
	check('a level is read from its attribute, or from a first line that names it',
		[read.businessComplexity, read.technicalComplexity],
		[{ level: 'medium', reasons: 'Tři skupiny uživatelů.' }, { level: 'high', reasons: 'napojení na SAP a na docházku.' }]);
	check('the work is read in either form, a range as its middle, a comma as a decimal point, a slip capped',
		read.work, [
			{ name: 'Rezervační formulář', days: 8 },
			{ name: 'Přehled obsazenosti', days: 5 },
			{ name: 'Napojení na SAP', days: 4 },
			{ name: 'Správa', days: 1.5 },
			{ name: 'Migrace', days: MAX_PART_DAYS }
		]);
	check('services are read from the list, a size as a word, and the header is not a service',
		read.services.map((s) => [s.key, s.size]), [['app-service', 'm'], ['sql', 's'], ['sql', 'l'], ['monitoring', 's']]);
	check('a service not in the list is kept by name, not priced', read.unpriced, ['SAP connector']);
	check('a section whose closing tag was dropped still ends at the end of the reply',
		read.assumptions.includes('300 uživatelů'), true);
	check('a reply with no pitch, or no work, is not an overview',
		[extractOverview(reply.replace(/<pitch>[\s\S]*?<\/pitch>/, '')), extractOverview(reply.replace(/<work>[\s\S]*?<\/work>/, ''))], [null, null]);
	check('nor is talk with no sections at all', extractOverview('I could not write it.'), null);
	check('a level that is none of the three is no level', extractOverview(reply.replace('level="medium"', 'level="LEVEL"')).businessComplexity.level, null);

	const settled = settleOverview(read, { reach: 'company' });
	check('the same service named twice is counted once, at its larger size',
		settled.services.filter((s) => s.key === 'sql').map((s) => s.size), ['l']);
	check('what every application needs is counted whether named or not',
		BASELINE.every((key) => settled.services.some((s) => s.key === key)), true);
	check('and the services read in the catalogue\'s order',
		settled.services.map((s) => s.key), CATALOGUE.map((s) => s.key).filter((key) => settled.services.some((s) => s.key === key)));
	check('nothing is said to be settled when the reply made every judgement', settled.settled, []);

	const bare = settleOverview({ ...read, services: [], businessComplexity: { level: null, reasons: '' }, technicalComplexity: { level: null, reasons: '' } }, { reach: 'external' });
	check('with no hosting chosen, App Service is counted', bare.services.some((s) => s.key === 'app-service'), true);
	check('reached from outside the company, a front door with a firewall is counted', bare.services.some((s) => s.key === 'front-door'), true);
	check('a missing rating is derived from the work and the reach, and says so',
		[bare.technicalComplexity.level, bare.businessComplexity.level, bare.settled.length], ['high', 'high', 4]);
	check('a team tool with no hosting gets the smallest',
		settleOverview({ ...read, services: [] }, { reach: 'team' }).services.find((s) => s.key === 'app-service').size, 's');
	check('nobody outside the company, no front door', settled.services.some((s) => s.key === 'front-door'), false);

	// The figures: 50 days of building at medium technical complexity.
	const fifty = { work: [{ name: 'All of it', days: 50 }], technicalComplexity: { level: 'medium', reasons: '' } };
	const people = byHand(fifty);
	check('by hand: the building, and what Specman adds to it in half days',
		people.rows.map((r) => r.days), [50, 6, 12.5, 5, 6]);
	check('the total is the rows as shown, costed at the day rate',
		[people.days, people.cost, people.cost === people.rows.reduce((sum, r) => sum + r.days, 0) * DAY_RATE], [79.5, 47_700, true]);
	check('the range is wider above than below, rounded to the thousand', [people.costLow, people.costHigh, people.daysLow, people.daysHigh], [38_000, 72_000, 64, 119]);
	check('and the calendar follows from the team', [people.people, people.weeks], [3, 7]);
	const ai = withAi(fifty);
	check('with AI: people look in to direct and review, little is managed, and its usage is costed on top',
		[ai.rows.map((r) => r.days), ai.usage, ai.cost], [[5, 4, 6, 1, 2], 2000, 18 * DAY_RATE + 2000]);
	check('and hosting takes fewer days, because it writes the pipelines and templates too',
		[ai.rows[4].days < people.rows[4].days, withAi({ ...fifty, technicalComplexity: { level: 'high', reasons: '' } }).rows[4].days], [true, 2]);
	check('so the application asked about fits into two weeks: 43 days of building at medium complexity',
		[withAi({ ...fifty, work: [{ name: 'All', days: 43 }] }).days, withAi({ ...fifty, work: [{ name: 'All', days: 43 }] }).weeks], [16, 2]);
	check('the AI route costs less than by hand, and takes fewer people', [ai.cost < people.cost, ai.people < people.people], [true, true]);
	check('directing it takes more of the building as the technology gets harder',
		withAi({ ...fifty, technicalComplexity: { level: 'high', reasons: '' } }).rows[0].days > ai.rows[0].days, true);
	const slower = [];
	// From two days: below that, every row is the half-day minimum on both routes.
	for (const days of [2, 5, 10, 20, 35, 50, 120, 300, 800]) {
		for (const level of ['low', 'medium', 'high']) {
			const shape = { work: [{ name: 'All', days }], technicalComplexity: { level, reasons: '' } };
			const [hand, assisted] = [byHand(shape), withAi(shape)];
			if (assisted.weeks > hand.weeks || assisted.cost >= hand.cost) slower.push([days, level]);
		}
	}
	check('at any size, the AI route is neither slower nor dearer than by hand', slower, []);
	check('a tiny piece of work is never shown as no work', withAi({ ...fifty, work: [{ name: 'x', days: 0.5 }] }).rows.every((r) => r.days >= 0.5), true);

	const run = runningCosts({ ...fifty, services: [{ key: 'app-service', size: 'm', why: '' }, { key: 'key-vault', size: 's', why: '' }] });
	check('running: production is the services\' sum, other environments a share of it, a year twelve months',
		[run.production, run.nonProduction, run.monthly, run.yearly], [232, 93, 325, 3900]);
	check('and support is a share of building it by hand, rounded to the hundred below ten thousand', run.support, 7200);

	check('the catalogue prices every service at three sizes, never less for a larger one',
		CATALOGUE.filter((s) => !(s.sizes.s.monthly >= 0 && s.sizes.s.monthly <= s.sizes.m.monthly && s.sizes.m.monthly <= s.sizes.l.monthly)).map((s) => s.key), []);
	const prompt = buildOverviewPrompt();
	check('the prompt lists every service it may choose, from the table that prices them',
		CATALOGUE.filter((s) => s.key !== 'entra-id' && !prompt.includes(`- ${s.key}:`)).map((s) => s.key), []);
	check('and asks for no money, because the code counts', /Write no money/.test(prompt), true);
	check('asked again, it is told why and to start at once',
		[buildOverviewPrompt(true).includes('COULD NOT BE USED'), prompt.includes('COULD NOT BE USED')], [true, false]);
	check('the request carries the document and what the triage said',
		overviewRequest('# Pool cars', 'used by a single team', true),
		'# Pool cars\n\n---\n\nThis application is used by a single team. It changes an application that already exists.\n\nWrite the overview of this application now.');

	check('what is kept reads back as it was', readOverview(JSON.parse(JSON.stringify(settled))), settled);
	check('what this module would not have written is not read',
		[readOverview(null), readOverview({ pitch: 'x', work: [] }), readOverview({ ...settled, services: [{ key: 'mainframe', size: 's' }] }).services],
		[null, null, []]);

	const thirds = shareOfWork([{ name: 'a', days: 1 }, { name: 'b', days: 1 }, { name: 'c', days: 1 }]);
	check('each part is shown as its share of the building, adding up to exactly 100',
		[thirds.map((s) => s.percent), shareOfWork(read.work).reduce((sum, s) => sum + s.percent, 0)], [[34, 33, 33], 100]);
	check('the largest remainders get the rounding, so a share is never more than a point off',
		shareOfWork([{ name: 'a', days: 8 }, { name: 'b', days: 5 }, { name: 'c', days: 4 }, { name: 'd', days: 1.5 }]).map((s) => s.percent), [43, 27, 22, 8]);
	check('a part too small for a whole per cent is shown as under one, and nothing is lost',
		[shareOfWork([{ name: 'big', days: 300 }, { name: 'tiny', days: 0.5 }]).map((s) => s.percent),
			renderReport(buildReport({ ...settled, work: [{ name: 'big', days: 300 }, { name: 'tiny', days: 0.5 }] }, { name: 'x', madeOn: '', stale: false })).includes('under 1%')],
		[[100, 0], true]);
	check('text is shown as paragraphs and lists, never markup',
		toBlocks('## Heading\nOne **line**\nand more.\n- a\n- b\n\nLast.'),
		[{ kind: 'paragraph', text: 'Heading' }, { kind: 'paragraph', text: 'One line' }, { kind: 'paragraph', text: 'and more.' }, { kind: 'list', items: ['a', 'b'] }, { kind: 'paragraph', text: 'Last.' }]);
	check('a section asked for as short lines is a list, bullets or not',
		toBlocks('One.\nTwo.\n\n- Three.', true), [{ kind: 'list', items: ['One.', 'Two.', 'Three.'] }]);
	check('but one line alone is a sentence, not a list of one', toBlocks('Only this.', true), [{ kind: 'paragraph', text: 'Only this.' }]);

	const hostile = { ...settled, pitch: 'Fine <script>alert(1)</script> <img src=x onerror=alert(2)>' };
	const file = renderReport(buildReport(hostile, { name: 'Cars --> <b>', madeOn: '2026-10-03', stale: false }));
	check('the file runs nothing: the model\'s words are escaped and there is no script',
		[/<script/i.test(file), /<img/i.test(file), file.includes('&lt;script&gt;')], [false, false, true]);
	check('nothing in the name ends its comment early', file.split('-->').length, 2);
	const parts = file.slice(file.indexOf('What the building consists of'), file.indexOf('Running it on Azure'));
	check('what the building consists of is told in shares of the work, not person-days',
		[/Share of the work/.test(parts), /Person-days/.test(parts), /width:\d+%/.test(parts)], [true, false, true]);
	check('it carries its own policy, for a file opened from a disk', file.includes(`content="${REPORT_POLICY}"`), true);
	check('it says when it was made, and that it is an estimate', [file.includes('2026-10-03'), /estimates for planning, not a quote/.test(file)], [true, true]);
	check('it says it is out of date only when it is',
		[/has changed since/.test(file), /has changed since/.test(renderReport(buildReport(settled, { name: 'x', madeOn: '', stale: true })))], [false, true]);
	check('every figure in it is calculated, not written by the model',
		file.includes(new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(byHand(settled).cost)), true);
	check('it is sent with the same policy and may not be framed',
		[reportHeaders()['content-security-policy'].startsWith(REPORT_POLICY), /frame-ancestors 'none'/.test(reportHeaders()['content-security-policy'])], [true, true]);
	check('the file is named for the application', [reportFileName('pool-cars'), reportFileName('"; x'), reportFileName('')],
		['pool-cars-overview.html', 'x-overview.html', 'application-overview.html']);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
