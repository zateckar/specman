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
import { mapWithLimit } from '../src/lib/server/llm/parallel.ts';
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
import { attemptAddress, mayAssertIdentity, readForwardedIdentity } from '../src/lib/server/llm/forwarded.ts';
import { safeReturnPath } from '../src/lib/server/llm/return-path.ts';
import { describeFailure } from '../src/lib/server/llm/failures.ts';
import { FREE_ATTEMPTS, SignInAttempts } from '../src/lib/server/llm/attempts.ts';
import { createLocks } from '../src/lib/server/llm/lock.ts';
import { createPresence } from '../src/lib/server/llm/presence.ts';
import { readFrames } from '../src/lib/sse.ts';

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

// Who may claim to be someone. With nothing configured, anyone may — which is
// the documented default and the reason the server warns at boot.
check('with no list configured, any peer may assert', mayAssertIdentity('203.0.113.9', []), true);
check('a listed peer may assert', mayAssertIdentity('10.0.0.4', ['10.0.0.4']), true);
check('an unlisted peer may not', mayAssertIdentity('203.0.113.9', ['10.0.0.4']), false);
check('an unknown peer may not, once a list exists', mayAssertIdentity(null, ['10.0.0.4']), false);

// An IPv4 peer arriving mapped into IPv6 is the same machine. An operator should
// not have to know the socket did that to write the address down.
check('an IPv4-mapped peer matches its plain form', mayAssertIdentity('::ffff:10.0.0.4', ['10.0.0.4']), true);
check('and the other way round', mayAssertIdentity('10.0.0.4', ['::ffff:10.0.0.4']), true);
check('a blank entry does not match everything', mayAssertIdentity('10.0.0.9', ['', '10.0.0.4']), false);

// Which address a failed password is counted against. Behind the proxy, every
// attempt came from the proxy, and one person's typos locked out everyone.
check('behind a trusted proxy, the caller it saw is counted', attemptAddress('10.0.0.4', '198.51.100.7, 192.0.2.1', ['10.0.0.4']), '192.0.2.1');
check('an untrusted peer cannot choose its own address', attemptAddress('203.0.113.9', '192.0.2.1', ['10.0.0.4']), '203.0.113.9');
check('with no proxy configured the header is ignored', attemptAddress('203.0.113.9', '192.0.2.1', []), '203.0.113.9');
check('a trusted proxy that sent no header is counted itself', attemptAddress('10.0.0.4', null, ['10.0.0.4']), '10.0.0.4');

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
