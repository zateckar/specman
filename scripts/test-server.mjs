/** Boundary regressions with real SQLite/Git and simulated external services. */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { simpleGit } from 'simple-git';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';

const root = mkdtempSync(join(tmpdir(), 'specman-boundaries-'));
assert.equal(dirname(resolve(root)), resolve(tmpdir()));
process.env.DATABASE_PATH = join(root, 'fixture.db');
process.env.ADMIN_PASSWORD = '';
process.env.LLM_URL = 'https://fixture.invalid';
process.env.LLM_API_KEY = 'fixture';
process.env.LLM_MODEL = 'fixture';
process.env.OIDC_ISSUER = 'https://fixture.invalid';
process.env.OIDC_CLIENT_ID = 'fixture';
process.env.OIDC_CLIENT_SECRET = 'fixture';

// Seed a database predating the failed-coverage column, to exercise real migration.
const old = new DatabaseSync(process.env.DATABASE_PATH);
old.exec(`CREATE TABLE verifications (id INTEGER PRIMARY KEY, project_id INTEGER,
  issues TEXT DEFAULT '[]', checked TEXT DEFAULT '[]', created_at TEXT DEFAULT (datetime('now')));
  INSERT INTO verifications (project_id) VALUES (999);
  CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT UNIQUE,
    description TEXT DEFAULT '', template_id INTEGER, owner_id INTEGER, repo_path TEXT,
    created_at TEXT DEFAULT (datetime('now')));
  INSERT INTO projects (id,name,slug,template_id,owner_id,repo_path)
    VALUES (999,'Legacy project','legacy-project',1,1,'unused-legacy-repository');`);
old.close();

const oidcEntry = import.meta.resolve('openid-client');
globalThis.specmanTestClaims = {};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('$lib/')) {
      const base = new URL(`../src/lib/${specifier.slice(5)}`, import.meta.url);
      for (const suffix of ['.ts', '/index.ts']) {
        const candidate = new URL(base.href + suffix);
        if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.svelte')) return {
      format: 'module', shortCircuit: true,
      source: compile(readFileSync(fileURLToPath(url), 'utf8'), {
        filename: fileURLToPath(url), generate: 'server'
      }).js.code
    };
    if (url === oidcEntry) return {
      format: 'module', shortCircuit: true,
      source: `export async function discovery() { return {}; }
        export async function authorizationCodeGrant() {
          return { claims() { return globalThis.specmanTestClaims; } };
        }`
    };
    return nextLoad(url, context);
  }
});

const store = await import('../src/lib/server/db/index.ts');
const proposals = await import('../src/lib/server/proposals.ts');
const repo = await import('../src/lib/server/git/repo.ts');
const { completeLogin, OidcNameCollision } = await import('../src/lib/server/auth/oidc.ts');
const { GatewayProvider, gateway } = await import('../src/lib/server/llm/gateway.ts');
const { verifyDocument } = await import('../src/lib/server/llm/verification.ts');
const chat = await import('../src/routes/api/chat/+server.ts');
const decisionsApi = await import('../src/routes/api/decisions/+server.ts');
const verifyApi = await import('../src/routes/api/verify/+server.ts');
const reviewPage = await import('../src/routes/projects/[id]/review/+page.server.ts');
const { default: ReviewPage } = await import('../src/routes/projects/[id]/review/+page.svelte');
const database = store.db();
const realFetch = globalThis.fetch;
const realStream = gateway.streamChat;
const realTools = gateway.callWithTools;
let passed = 0;
function check(name, actual, expected) {
  assert.deepEqual(actual, expected, name);
  passed++;
  console.log(`PASS  ${name}`);
}
async function rejects(name, work, expected) {
  await assert.rejects(work, expected);
  passed++;
  console.log(`PASS  ${name}`);
}
const event = (body) => ({ request: new Request('https://fixture.invalid/api', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
}), locals: { user: store.getUser(1) } });
const frame = (data) => `data: ${JSON.stringify(data)}\n\n`;
const textFrame = (text) => frame({ type: 'content_block_delta', delta: { type: 'text_delta', text } });
const stopFrame = frame({ type: 'message_stop' });
const request = { messages: [{ role: 'user', content: 'fixture' }] };
const readStream = async (provider = new GatewayProvider()) => {
  const events = [];
  for await (const item of provider.streamChat(request)) events.push(item);
  return events;
};
const fixtureProject = (slug) => store.createProject({ name: slug, description: 'Committed description',
  ownerId: 1, templateId: store.defaultTemplate().id, slug, repoPath: join(root, slug), kind: 'change' });
const approveLatest = async (project, proposal) => proposals.approveProposal(project, proposal, await proposals.reviewRevision(project, proposal));
const approveForm = (project, reviewed = {}) => reviewPage.actions.approve({
  params: { id: String(project.id) }, request: new Request('https://fixture.invalid/review?/approve', {
    method: 'POST', body: new URLSearchParams(Object.entries(reviewed).map(([key, value]) => [key, String(value)]))
  })
});
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const journal = async (project) => {
  const proposal = proposals.openProposal(project.id);
  const reviewed = await proposals.reviewRevision(project, proposal);
  database.prepare(`INSERT INTO approval_intents (proposal_id,project_id,proposal_revision,main_revision,phase)
    VALUES (?,?,?,?,'prepared')`).run(proposal.id, project.id, reviewed.proposalRevision, reviewed.mainRevision);
  return { proposal, reviewed };
};
const intentFor = (proposal) => database.prepare('SELECT * FROM approval_intents WHERE proposal_id = ?').get(proposal.id);

try {
  check('older verification rows migrate without losing their result', store.latestVerification(999).failed, []);
  check('older verification coverage is unknown rather than current', store.latestVerification(999).stale, true);
  check('an existing project receives an initial revision without losing its name',
    [store.getProject(999).document_revision, store.getProject(999).name], [0, 'Legacy project']);
  database.prepare("INSERT INTO users (username,is_admin,created_via) VALUES ('original-admin',1,'oidc')").run();
  database.prepare("INSERT INTO oidc_identities (user_id,issuer,subject) VALUES (1,?,'original-subject')").run(process.env.OIDC_ISSUER);
  const login = () => completeLogin(new URL('https://fixture.invalid/callback'), 'state', 'verifier');
  globalThis.specmanTestClaims = { iss: process.env.OIDC_ISSUER, sub: 'different-subject', preferred_username: 'original-admin' };
  await rejects('a recycled SSO name cannot inherit administrator rights', login, OidcNameCollision);
  check('a refused subject gains no identity link', database.prepare('SELECT COUNT(*) AS n FROM oidc_identities').get().n, 1);
  globalThis.specmanTestClaims.sub = 'original-subject';
  globalThis.specmanTestClaims.preferred_username = 'renamed-account';
  check('the authoritative identity survives a username change', (await login()).id, 1);
  globalThis.specmanTestClaims = { iss: process.env.OIDC_ISSUER, sub: 'new-subject', preferred_username: 'new-colleague' };
  check('a new identity is registered without administrator rights', (await login()).is_admin, 0);
  database.prepare("INSERT INTO users (username,created_via) VALUES ('proxy-colleague','proxy')").run();
  globalThis.specmanTestClaims = { iss: process.env.OIDC_ISSUER, sub: 'proxy-collision', preferred_username: 'proxy-colleague' };
  await rejects('OIDC cannot adopt a proxy account with the same name', login, OidcNameCollision);

  globalThis.fetch = async () => new Response(textFrame('partial') + frame({ type: 'error', error: { type: 'overloaded_error' } }));
  await rejects('an SSE error after text fails the stream', () => readStream(), /interrupted/);
  globalThis.fetch = async () => new Response(textFrame('partial'));
  await rejects('EOF without a successful terminator fails the stream', () => readStream(), /before it was complete/);
  globalThis.fetch = async () => new Response(textFrame('partial') + frame({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }) + stopFrame);
  await rejects('token truncation cannot report completion', () => readStream(), /ran out of room/);
  const crlf = (textFrame('complete') + stopFrame).replaceAll('\n', '\r\n');
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
    for (const char of crlf) controller.enqueue(new TextEncoder().encode(char));
    controller.close();
  } }));
  check('CRLF frames split at every byte still complete', (await readStream()).map((e) => e.type), ['text', 'done']);
  globalThis.fetch = async () => new Response(stopFrame);
  check('a successfully empty response is allowed', (await readStream()).map((e) => e.type), ['done']);
  globalThis.fetch = async () => new Response(textFrame('complete') + 'data: [DONE]\n\n');
  check('an explicit gateway DONE sentinel also completes', (await readStream()).map((e) => e.type), ['text', 'done']);

  const project = fixtureProject('approval');
  store.updateChapterState(project.id, 'overview', { contentMd: 'Reviewed version A', status: 'complete' });
  const rule = store.saveRequirement(project.id, { chapterKey: 'overview', statement: 'Reviewed rule A', scope: 'now', scenarios: [{ when: 'requested', then: 'done' }], existing: 1 });
  await proposals.commitDocument(project, 'Reviewed revision');
  const proposal = proposals.openProposal(project.id);
  store.updateChapterState(project.id, 'overview', { contentMd: 'UNREVIEWED version B' });
  store.saveRequirement(project.id, { ref: rule.ref, chapterKey: 'overview', statement: 'UNREVIEWED rule B', scope: 'now', scenarios: [], existing: 0 });
  const page = await reviewPage.load({ params: { id: String(project.id) } });
  check('review summaries use the recorded branch rather than live requirements', page.changes[0].after.statement, 'Reviewed rule A');
  await proposals.approveProposal(project, proposal, page.reviewed);
  const git = simpleGit(project.repo_path);
  const approvedInput = await repo.specInputOnBranch(project.repo_path, 'main');
  check('approval keeps the reviewed prose', approvedInput.chapters.find(c => c.key === 'overview').content_md, 'Reviewed version A');
  check('approval keeps requirement metadata', approvedInput.requirements[0].existing, 1);
  const specPaths = (await git.raw(['ls-tree', '-r', '--name-only', 'main', 'spec'])).trim().split('\n');
  const specText = (await Promise.all(specPaths.map(path => git.show([`main:${path}`])))).join('\n');
  check('the approved build bundle contains no unreviewed prose or rules', specText.includes('UNREVIEWED'), false);
  check('later database answers remain saved for a future proposal', store.getChapter(project.id, 'overview').content_md, 'UNREVIEWED version B');
  await proposals.commitDocument(project, 'Record the next revision for review');
  const dirtyProposal = proposals.openProposal(project.id);
  writeFileSync(join(project.repo_path, 'specman.export.json'), 'Uncommitted replacement');
  await rejects('approval cannot stage leftovers from a failed commit onto main', () => approveLatest(project, dirtyProposal), proposals.UnrecordedChanges);
  check('a refused approval leaves the proposal open', proposals.openProposal(project.id).id, dirtyProposal.id);
  check('a refused approval preserves the approved main revision', (await repo.specInputOnBranch(project.repo_path, 'main')).chapters.find(c => c.key === 'overview').content_md, 'Reviewed version A');
  await git.checkout(['--', 'specman.export.json']);

  const stale = await reviewPage.load({ params: { id: String(project.id) } });
  const oldMain = await repo.resolveRevision(project.repo_path, 'main');
  store.updateChapterState(project.id, 'overview', { contentMd: 'Committed after the review' });
  await proposals.commitDocument(project, 'Advance the reviewed proposal');
  check('approval refuses a proposal changed since the page loaded', (await approveForm(project, stale.reviewed)).status, 409);
  check('a stale approval leaves main unchanged', await repo.resolveRevision(project.repo_path, 'main'), oldMain);
  check('a stale approval leaves the proposal open', proposals.openProposal(project.id).id, dirtyProposal.id);
  check('a review with no revision cannot approve current changes', (await approveForm(project)).status, 409);
  check('a malformed revision cannot approve current changes', (await approveForm(project, { ...stale.reviewed, proposalRevision: 'main' })).status, 409);
  const fresh = await reviewPage.load({ params: { id: String(project.id) } });
  check('a refreshed review shows the new immutable revision', fresh.reviewed.proposalRevision, await repo.resolveRevision(project.repo_path, dirtyProposal.branch));
  const staleHtml = render(ReviewPage, { props: { data: fresh, form: { message: 'Review the updated changes before approving.' } } }).body;
  check('the approval form carries the reviewed commit', staleHtml.includes(`value="${fresh.reviewed.proposalRevision}"`), true);
  check('stale approval instructions are visible', staleHtml.includes('Review the updated changes before approving.'), true);
  await git.checkout('main');
  await git.commit('Advance the approved base', ['--allow-empty']);
  await git.checkout(dirtyProposal.branch);
  check('approval refuses a base changed since review', (await approveForm(project, fresh.reviewed)).status, 409);

  // The check must happen after acquiring ownership, not before waiting for it.
  const queuedReview = await proposals.reviewRevision(project, dirtyProposal);
  let releaseApprovalWriter;
  let enteredApprovalWriter;
  const approvalGate = new Promise(resolve => { releaseApprovalWriter = resolve; });
  const approvalEntered = new Promise(resolve => { enteredApprovalWriter = resolve; });
  const approvalWriter = repo.withRepo(project.repo_path, async () => {
    enteredApprovalWriter(); await approvalGate;
    await git.commit('Commit while approval waits', ['--allow-empty']);
  });
  await approvalEntered;
  const queuedApproval = approveForm(project, queuedReview);
  await new Promise(setImmediate);
  releaseApprovalWriter();
  await approvalWriter;
  check('approval revalidates the revision after waiting for the lock', (await queuedApproval).status, 409);
  const latestReview = await proposals.reviewRevision(project, dirtyProposal);
  await rejects('a fresh reviewed form successfully redirects after approval', () => approveForm(project, latestReview), e => e.status === 303);
  check('rewriting the approved document without changes creates no commit', await proposals.commitDocument(project, 'Unchanged document after approval'), null);
  store.updateChapterState(project.id, 'overview', { contentMd: 'A replacement proposal for later review' });
  await proposals.commitDocument(project, 'Create the next proposal');
  check('an old form cannot approve a replacement proposal', (await approveForm(project, latestReview)).status, 409);

  const legacy = fixtureProject('legacy');
  store.updateChapterState(legacy.id, 'overview', { contentMd: 'Legacy reviewed prose', status: 'complete' });
  const legacyParent = store.projectChapters(legacy.id).find(c => c.is_dynamic && !c.parent_key);
  store.applySectionPlan(legacy.id, legacyParent, [{ key: 'reports', title: 'Reports' }]);
  const legacySection = store.projectChapters(legacy.id).find(c => c.parent_key === legacyParent.key);
  store.updateChapterState(legacy.id, legacySection.key, { contentMd: 'Committed report capability' });
  store.setChapterApplicable(legacy.id, 'security', false, 'No relevant security scope in this fixture.');
  store.updateChapterState(legacy.id, 'overview', { openQuestions: ['Who owns it?'] });
  store.saveRequirement(legacy.id, { chapterKey: 'overview', statement: 'Keep the recorded requirement', scope: 'now', scenarios: [{ when: 'requested', then: 'done' }] });
  await proposals.commitDocument(legacy, 'Legacy revision');
  const legacyProposal = proposals.openProposal(legacy.id);
  const legacyGit = simpleGit(legacy.repo_path);
  await legacyGit.rm('specman.export.json');
  await legacyGit.commit('Simulate a pre-snapshot proposal');
  store.updateChapterState(legacy.id, 'overview', { contentMd: 'UNREVIEWED legacy replacement' });
  await approveLatest(legacy, legacyProposal);
  const legacyInput = await repo.specInputOnBranch(legacy.repo_path, 'main');
  check('older proposals export committed chapter prose', legacyInput.chapters.find(c => c.key === 'overview').content_md, 'Legacy reviewed prose');
  check('older proposals flag metadata that cannot be recovered', legacyInput.problems.some(p => p.message.includes('older proposal')), true);
  check('older proposals preserve their recorded rules', legacyInput.requirements[0].statement, 'Keep the recorded requirement');
  check('older proposals preserve open questions separately from prose', legacyInput.chapters.find(c => c.key === 'overview').open_questions, ['Who owns it?']);
  check('older proposals preserve set-aside chapters', legacyInput.chapters.find(c => c.key === 'security').applicable, 0);
  check('older sub-chapters keep their relative file position', legacyInput.chapters.find(c => c.key === legacySection.key).position, legacySection.position);
  check('older sub-chapters retain their prose', legacyInput.chapters.find(c => c.key === legacySection.key).content_md, 'Committed report capability');

  const decisionProject = fixtureProject('decisions');
  store.updateChapterState(decisionProject.id, 'overview', { contentMd: 'Decision fixture' });
  const decision = store.saveDecision(decisionProject.id, { chapterKey: 'overview', statement: 'Keep backups', rationale: 'Recovery', source: 'assistant' });
  await proposals.commitDocument(decisionProject, 'Initial decision');
  await decisionsApi.POST(event({ projectId: decisionProject.id, id: decision.id, action: 'confirm' }));
  const decisionGit = simpleGit(decisionProject.repo_path);
  const decisionBranch = proposals.openProposal(decisionProject.id).branch;
  check('confirmation immediately reaches the Git decision log', (await decisionGit.show([`${decisionBranch}:decisions.md`])).includes('all confirmed'), true);
  await approveLatest(decisionProject, proposals.openProposal(decisionProject.id));
  const discarded = store.saveDecision(decisionProject.id, { chapterKey: 'overview', statement: 'Discard this assumption', rationale: '', source: 'assistant' });
  await proposals.commitDocument(decisionProject, 'New assumption');
  await decisionsApi.POST(event({ projectId: decisionProject.id, id: discarded.id, action: 'discard' }));
  const afterDiscard = await repo.specInputOnBranch(decisionProject.repo_path, proposals.openProposal(decisionProject.id).branch);
  check('discard removes the assumption from the committed export', afterDiscard.decisions.some(d => d.statement === discarded.statement), false);
  await rejects('unknown decision actions are refused', () => decisionsApi.POST(event({ projectId: decisionProject.id, id: decision.id, action: 'bogus' })), e => e.status === 400);
  const queuedDecision = store.saveDecision(decisionProject.id, { chapterKey: 'overview', statement: 'Wait for the repository', rationale: '', source: 'assistant' });
  await proposals.commitDocument(decisionProject, 'Decision waiting to be confirmed');
  let release;
  let entered;
  const held = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const holder = repo.withRepo(decisionProject.repo_path, async () => { entered(); await gate; });
  await held;
  const queued = decisionsApi.POST(event({ projectId: decisionProject.id, id: queuedDecision.id, action: 'confirm' }));
  await new Promise(setImmediate);
  check('a queued decision cannot mutate the database during approval work', store.getDecision(queuedDecision.id).status, 'proposed');
  release();
  await holder;
  await queued;
  check('the queued choice is recorded after the repository is released', store.getDecision(queuedDecision.id).status, 'confirmed');
  const blockedDecision = store.saveDecision(decisionProject.id, { chapterKey: 'overview', statement: 'Saved despite Git failure', rationale: '', source: 'assistant' });
  const blockedPath = join(root, 'blocked-repository');
  writeFileSync(blockedPath, 'This is a file, not a repository directory.');
  database.prepare('UPDATE projects SET repo_path = ? WHERE id = ?').run(blockedPath, decisionProject.id);
  await rejects('a failed decision commit is reported to the caller', () => decisionsApi.POST(event({ projectId: decisionProject.id, id: blockedDecision.id, action: 'confirm' })), e => e.status === 503 && e.body.message.includes('history'));
  check('a failed decision commit preserves the user choice', store.getDecision(blockedDecision.id).status, 'confirmed');
  database.prepare('UPDATE projects SET repo_path = ? WHERE id = ?').run(decisionProject.repo_path, decisionProject.id);
  await proposals.commitDocument(decisionProject, 'Recover saved decision changes');
  check('the next commit recovers the previously unrecorded choice', (await repo.specInputOnBranch(decisionProject.repo_path, proposals.openProposal(decisionProject.id).branch)).decisions.find(d => d.statement === blockedDecision.statement).status, 'confirmed');

  const chatProject = fixtureProject('chat');
  gateway.streamChat = async function* () {
    yield { type: 'text', text: '<decision chapter="overview" source="user">Use weekly backups\nWhy: Recovery</decision>' };
    yield { type: 'done', servedBy: 'fixture', outputTokens: 10 };
  };
  gateway.callWithTools = async () => ({ calls: [], text: '', servedBy: 'fixture', attempts: 1 });
  const chatResult = await chat.POST(event({ projectId: chatProject.id, chapterKey: null, message: 'Use weekly backups' }));
  const chatEvents = await chatResult.text();
  check('a decision-only turn commits its change', chatEvents.includes('event: commit'), true);
  check('the decision-only change reaches the proposal snapshot', (await repo.specInputOnBranch(chatProject.repo_path, proposals.openProposal(chatProject.id).branch)).decisions[0].statement, 'Use weekly backups');

  // Run the real provider through the actual chat route to prove partial drafts
  // cannot overwrite stored prose after a stream error.
  store.updateChapterState(chatProject.id, 'overview', { contentMd: 'Preserve this prose' });
  gateway.streamChat = realStream;
  globalThis.fetch = async () => new Response(textFrame('<chapter key="overview">Partial replacement') + frame({ type: 'error', error: { type: 'overloaded_error' } }));
  const failedChat = await chat.POST(event({ projectId: chatProject.id, chapterKey: 'overview', message: 'Update it' }));
  const failedChatEvents = await failedChat.text();
  check('an interrupted chat reports failure to its reader', failedChatEvents.includes('event: error'), true);
  check('an interrupted draft does not replace chapter prose', store.getChapter(chatProject.id, 'overview').content_md, 'Preserve this prose');

  const verifyProject = fixtureProject('verification');
  store.updateChapterState(verifyProject.id, 'overview', { contentMd: 'Overview prose' });
  store.updateChapterState(verifyProject.id, 'security', { contentMd: 'Security prose' });
  store.saveRequirement(verifyProject.id, { chapterKey: 'overview', statement: 'A rule', scope: 'now', scenarios: [] });
  store.saveRequirement(verifyProject.id, { chapterKey: 'security', statement: 'Another rule', scope: 'now', scenarios: [] });
  await proposals.commitDocument(verifyProject, 'Document to verify');
  gateway.streamChat = async function* (req) {
    if (!req.system.includes('chapters="security"')) throw new Error('Simulated coverage outage');
    yield { type: 'text', text: '<finding kind="unclear" chapters="security">State who can access backups.</finding>' };
    yield { type: 'done', servedBy: 'fixture', outputTokens: 10 };
  };
  const verifyResponse = await verifyApi.POST(event({ projectId: verifyProject.id }));
  const result = await verifyResponse.json();
  check('only successful chapters are counted as checked', result.checked, ['security']);
  check('failed chapters and cross-document coverage are reported', result.failed, ['overview', 'whole-document']);
  check('successful findings survive failures elsewhere', result.issues.length, 1);
  check('failed coverage survives reopening the stored result', store.latestVerification(verifyProject.id).failed, result.failed);
  const verifyGit = simpleGit(verifyProject.repo_path);
  const report = await verifyGit.show([`${proposals.openProposal(verifyProject.id).branch}:VERIFICATION.md`]);
  check('the Git report describes incomplete coverage', report.includes('Check incomplete'), true);
  check('an incomplete report does not assert agreement', report.includes('The document agrees with itself'), false);
  const reviewData = await reviewPage.load({ params: { id: String(verifyProject.id) } });
  const partialHtml = render(ReviewPage, { props: { data: reviewData } }).body;
  check('the review UI names incomplete coverage', partialHtml.includes('check incomplete') && partialHtml.includes('Could not check:'), true);
  check('the review UI keeps successful findings visible', partialHtml.includes('State who can access backups.'), true);
  gateway.streamChat = async function* () { throw new Error('Simulated complete outage'); };
  const outageResponse = await verifyApi.POST(event({ projectId: verifyProject.id }));
  const outage = await outageResponse.json();
  check('a total outage reports no successful chapters', outage.checked, []);
  check('a total outage reports every failed call', outage.failed, ['overview', 'security', 'whole-document']);
  check('the API cannot claim agreement after a total outage', outage.summary.startsWith('Check incomplete.') && !outage.summary.includes('holds together'), true);
  const outageHtml = render(ReviewPage, { props: { data: await reviewPage.load({ params: { id: String(verifyProject.id) } }) } }).body;
  check('the UI cannot call a total outage clean', outageHtml.includes('check incomplete') && !outageHtml.includes('nothing flagged'), true);
  gateway.streamChat = async function* () { yield { type: 'done', servedBy: 'fixture', outputTokens: 0 }; };
  const retry = await verifyDocument({ chapters: store.projectChapters(verifyProject.id), requirements: store.projectRequirements(verifyProject.id), decisions: [] });
  check('a successful retry clears failed coverage', retry.failed, []);
  check('a successful retry counts both chapters', retry.checked, ['overview', 'security']);

  console.log('\n--- optimistic document updates ---');
  const versioned = fixtureProject('versioned');
  const initialVersion = store.documentRevision(versioned.id);
  store.updateChapterState(versioned.id, 'overview', { contentMd: 'First saved version' });
  check('chapter writes advance the project revision', store.documentRevision(versioned.id) > initialVersion, true);
  const currentVersion = store.documentRevision(versioned.id);
  assert.throws(() => store.withDocumentRevision(versioned.id, currentVersion, () => {
    store.updateChapterState(versioned.id, 'overview', { contentMd: 'Must roll back' });
    store.saveRequirement(versioned.id, { chapterKey: 'overview', statement: 'Must roll back', scope: 'now', scenarios: [] });
    store.saveDecision(versioned.id, { chapterKey: 'overview', statement: 'Must roll back', rationale: '', source: 'agent' });
    throw new Error('Simulated transaction failure');
  }), /Simulated/);
  check('rollback restores prose, revision, requirements and decisions', [store.getChapter(versioned.id, 'overview').content_md,
    store.documentRevision(versioned.id), store.projectRequirements(versioned.id).length, store.projectDecisions(versioned.id).length],
    ['First saved version', currentVersion, 0, 0]);
  store.withDocumentRevision(versioned.id, currentVersion, () => store.updateChapterState(versioned.id, 'overview', { contentMd: 'Winning write' }));
  assert.throws(() => store.withDocumentRevision(versioned.id, currentVersion, () => store.updateChapterState(versioned.id, 'overview', { contentMd: 'Stale write' })), store.DocumentConflict);
  check('a reused snapshot cannot replace a winning write', store.getChapter(versioned.id, 'overview').content_md, 'Winning write');
  store.updateChapterState(versioned.id, 'overview', { contentMd: 'First saved version' });
  assert.throws(() => store.withDocumentRevision(versioned.id, currentVersion, () => {}), store.DocumentConflict);
  check('restoring old prose does not restore its old revision', store.documentRevision(versioned.id) > currentVersion, true);
  const beforeRules = store.documentRevision(versioned.id);
  const versionRule = store.saveRequirement(versioned.id, { chapterKey: 'overview', statement: 'Versioned rule', scope: 'now', scenarios: [] });
  store.deleteRequirement(versioned.id, versionRule.ref);
  check('requirement insertion and deletion both invalidate snapshots', store.documentRevision(versioned.id) >= beforeRules + 2, true);
  const beforeDecisions = store.documentRevision(versioned.id);
  const versionDecision = store.saveDecision(versioned.id, { chapterKey: 'overview', statement: 'Versioned decision', rationale: '', source: 'agent' });
  store.confirmDecision(versioned.id, versionDecision.id);
  store.deleteDecision(versioned.id, versionDecision.id);
  check('decision insertion, confirmation and deletion invalidate snapshots', store.documentRevision(versioned.id) >= beforeDecisions + 3, true);
  const beforeMetadata = store.documentRevision(versioned.id);
  database.prepare('UPDATE projects SET description = ? WHERE id = ?').run('Changed model context', versioned.id);
  check('project metadata invalidates a captured document', store.documentRevision(versioned.id), beforeMetadata + 1);
  assert.throws(() => database.prepare('UPDATE projects SET document_revision = ? WHERE id = ?').run(currentVersion, versioned.id), /must increase/);
  check('storage refuses to rewind a document revision', store.documentRevision(versioned.id), beforeMetadata + 1);
  database.prepare('UPDATE projects SET document_revision = ? WHERE id = ?').run(Number.MAX_SAFE_INTEGER, versioned.id);
  assert.throws(() => store.updateChapterState(versioned.id, 'overview', { contentMd: 'Unsafe overflow' }), /safe integer range/);
  check('revision exhaustion cannot save unversioned prose', store.getChapter(versioned.id, 'overview').content_md, 'First saved version');
  check('a failed overflow preserves the exact counter', store.documentRevision(versioned.id), Number.MAX_SAFE_INTEGER);

  const concurrent = fixtureProject('concurrent');
  const dynamic = store.projectChapters(concurrent.id).find(c => c.is_dynamic && !c.parent_key);
  const slowEntered = deferred();
  const finishSlow = deferred();
  gateway.callWithTools = async () => ({ calls: [], text: '', servedBy: 'fixture', attempts: 1 });
  gateway.streamChat = async function* (req) {
    const slow = req.messages.at(-1).content === 'Slow answer';
    if (slow) { slowEntered.resolve(); await finishSlow.promise; }
    yield { type: 'text', text: slow
      ? `<subchapters>stale-section: Stale section</subchapters><chapter key="overview">Stale prose</chapter><requirement chapter="overview">Stale rule</requirement><decision chapter="overview">Stale decision</decision>Stale answer.`
      : '<chapter key="overview">Winning concurrent prose</chapter>Winning answer.' };
    yield { type: 'done', servedBy: 'fixture', outputTokens: 1 };
  };
  const slowResponse = await chat.POST(event({ projectId: concurrent.id, chapterKey: dynamic.key, message: 'Slow answer' }));
  const slowBody = slowResponse.text();
  await slowEntered.promise;
  const fastResponse = await chat.POST(event({ projectId: concurrent.id, chapterKey: dynamic.key, message: 'Fast answer' }));
  await fastResponse.text();
  finishSlow.resolve();
  const staleEvents = await slowBody;
  check('a delayed chat reports a revision conflict', staleEvents.includes('proposed changes were not applied'), true);
  check('a stale reply emits no document mutation events', /event: (chapter|requirement|decision|sections|state|commit)\n/.test(staleEvents), false);
  check('the winning chapter cannot be replaced by a delayed reply', store.getChapter(concurrent.id, 'overview').content_md, 'Winning concurrent prose');
  check('a stale reply creates no requirements, decisions or sections', [store.projectRequirements(concurrent.id).length,
    store.projectDecisions(concurrent.id).length, store.projectChapters(concurrent.id).some(c => c.title === 'Stale section')], [0, 0, false]);
  check('both users retain their input in the transcript', store.recentMessages(concurrent.id, dynamic.key, 20).filter(m => m.role === 'user').length, 2);
  const independent = fixtureProject('independent');
  const independentVersion = store.documentRevision(independent.id);
  store.updateChapterState(concurrent.id, 'security', { contentMd: 'Another project changed' });
  store.withDocumentRevision(independent.id, independentVersion, () => store.updateChapterState(independent.id, 'overview', { contentMd: 'Independent write' }));
  check('conflicts in one application do not invalidate another', store.getChapter(independent.id, 'overview').content_md, 'Independent write');

  const assessing = fixtureProject('assessment-race');
  const assessmentEntered = deferred();
  const finishAssessment = deferred();
  gateway.streamChat = async function* () {
    yield { type: 'text', text: '<chapter key="overview">Assessment input</chapter>Recorded.' };
    yield { type: 'done', servedBy: 'fixture', outputTokens: 1 };
  };
  gateway.callWithTools = async () => {
    assessmentEntered.resolve(); await finishAssessment.promise;
    return { calls: [{ name: 'record_chapter_state', input: { status: 'complete', open_questions: [] } }], text: '', servedBy: 'fixture', attempts: 1 };
  };
  const assessingResponse = await chat.POST(event({ projectId: assessing.id, chapterKey: 'overview', message: 'Assess it' }));
  const assessingBody = assessingResponse.text();
  await assessmentEntered.promise;
  store.updateChapterState(assessing.id, 'overview', { status: 'in_progress', openQuestions: ['A newer question?'] });
  finishAssessment.resolve();
  check('a delayed assessment explains why it kept the newer state', (await assessingBody).includes('newer chapter state was kept'), true);
  check('a stale assessment cannot erase newer open questions', [store.getChapter(assessing.id, 'overview').status,
    store.getChapter(assessing.id, 'overview').open_questions], ['in_progress', ['A newer question?']]);

  console.log('\n--- durable approval cut points ---');
  for (const phase of ['before-merge', 'after-merge', 'during-bundle', 'after-bundle']) {
    const recovering = fixtureProject(`recovery-${phase}`);
    store.updateChapterState(recovering.id, 'overview', { contentMd: `Authorized ${phase}` });
    await proposals.commitDocument(recovering, 'Authorize this exact revision');
    const { proposal: recoveringProposal, reviewed } = await journal(recovering);
    const recoveringGit = simpleGit(recovering.repo_path);
    if (phase !== 'before-merge') await repo.mergeToMain(recovering.repo_path, reviewed.proposalRevision);
    if (phase === 'during-bundle' || phase === 'after-bundle') {
      const mergedRevision = await repo.resolveRevision(recovering.repo_path, 'main');
      database.prepare("UPDATE proposals SET state = 'merged' WHERE id = ?").run(recoveringProposal.id);
      database.prepare("UPDATE approval_intents SET phase = 'merged', merge_revision = ? WHERE proposal_id = ?").run(mergedRevision, recoveringProposal.id);
      repo.writeSpecBundle(recovering.repo_path, new Map([['partial.md', 'Interrupted output']]));
      if (phase === 'after-bundle') {
        const { buildSpecBundle } = await import('../src/lib/server/llm/export.ts');
        repo.writeSpecBundle(recovering.repo_path, buildSpecBundle(await repo.specInputOnBranch(recovering.repo_path, mergedRevision)));
        await repo.commitAll(recovering.repo_path, 'Update the build-ready specification', 'main');
      }
    }
    store.updateChapterState(recovering.id, 'overview', { contentMd: 'Newer unapproved database prose' });
    const reopened = new DatabaseSync(process.env.DATABASE_PATH, { readOnly: true });
    const durableIntent = reopened.prepare('SELECT phase FROM approval_intents WHERE proposal_id = ?').get(recoveringProposal.id);
    reopened.close();
    check(`${phase}: the recovery phase is visible to a fresh SQLite connection`, durableIntent.phase,
      phase === 'before-merge' || phase === 'after-merge' ? 'prepared' : 'merged');
    await proposals.recoverPendingApprovals();
    check(`${phase}: recovery completes the journal and closes the proposal`, [intentFor(recoveringProposal).phase, proposals.getProposal(recoveringProposal.id).state], ['complete', 'merged']);
    check(`${phase}: recovery consumes only the authorized snapshot`, (await repo.specInputOnBranch(recovering.repo_path, 'main')).chapters.find(c => c.key === 'overview').content_md, `Authorized ${phase}`);
    check(`${phase}: recovery leaves no generated leftovers`, await repo.hasChanges(recovering.repo_path), false);
    const recoveredMain = await repo.resolveRevision(recovering.repo_path, 'main');
    await proposals.recoverPendingApprovals();
    check(`${phase}: repeated recovery makes no new commit`, await repo.resolveRevision(recovering.repo_path, 'main'), recoveredMain);
    const mergeMessages = (await recoveringGit.log()).all.filter(c => c.message.startsWith('Merge design changes'));
    check(`${phase}: recovery does not duplicate the merge`, mergeMessages.length, 1);
    const nextProposal = await proposals.ensureWorkingProposal(recovering);
    check(`${phase}: subsequent writes use a new proposal`, nextProposal.id !== recoveringProposal.id, true);
  }

  const recordingFailure = fixtureProject('recovery-marker-failure');
  store.updateChapterState(recordingFailure.id, 'overview', { contentMd: 'Authorized despite marker failure' });
  await proposals.commitDocument(recordingFailure, 'Recorded before interrupted approval');
  const interruptedProposal = proposals.openProposal(recordingFailure.id);
  database.exec(`CREATE TRIGGER interrupt_merge_record BEFORE UPDATE OF phase ON approval_intents
    WHEN NEW.project_id = ${recordingFailure.id} AND NEW.phase = 'merged'
    BEGIN SELECT RAISE(ABORT, 'Simulated marker failure'); END;`);
  await rejects('a failed SQLite merge marker reports interruption', () => approveLatest(recordingFailure, interruptedProposal), /Simulated marker failure/);
  check('proposal closure and journal phase roll back together', [proposals.getProposal(interruptedProposal.id).state, intentFor(interruptedProposal).phase], ['draft', 'prepared']);
  check('the actual merge remains durable after marker failure', await repo.revisionIsAncestor(recordingFailure.repo_path, intentFor(interruptedProposal).proposal_revision, await repo.resolveRevision(recordingFailure.repo_path, 'main')), true);
  database.exec('DROP TRIGGER interrupt_merge_record');
  await proposals.ensureWorkingProposal(recordingFailure);
  check('the next writer recovers the interrupted marker first', [intentFor(interruptedProposal).phase, proposals.getProposal(interruptedProposal.id).state], ['complete', 'merged']);

  const bundleFailure = fixtureProject('recovery-bundle-failure');
  store.updateChapterState(bundleFailure.id, 'overview', { contentMd: 'Approved with recoverable bundle failure' });
  await proposals.commitDocument(bundleFailure, 'Bundle failure fixture');
  const bundleProposal = proposals.openProposal(bundleFailure.id);
  const blockedIndex = join(bundleFailure.repo_path, '.git/index.lock');
  const originalExec = database.exec;
  // Cut after the durable SQLite marker, before the remaining Git work starts.
  database.exec = function(sql) {
    const value = originalExec.call(this, sql);
    if (sql === 'COMMIT' && intentFor(bundleProposal)?.phase === 'merged') writeFileSync(blockedIndex, 'Simulated unavailable Git index');
    return value;
  };
  try { await approveLatest(bundleFailure, bundleProposal); }
  finally { database.exec = originalExec; }
  check('bundle failure retains approval and a pending recovery phase', [proposals.getProposal(bundleProposal.id).state, intentFor(bundleProposal).phase], ['merged', 'merged']);
  await rejects('a writer cannot bypass an unfinished bundle', () => proposals.ensureWorkingProposal(bundleFailure), proposals.ApprovalRecoveryBlocked);
  rmSync(blockedIndex);
  await proposals.ensureWorkingProposal(bundleFailure);
  check('a retry finishes the bundle before admitting a writer', intentFor(bundleProposal).phase, 'complete');

  const dirtyRecovery = fixtureProject('recovery-dirty');
  store.updateChapterState(dirtyRecovery.id, 'overview', { contentMd: 'Authorized dirty recovery fixture' });
  await proposals.commitDocument(dirtyRecovery, 'Dirty recovery fixture');
  const { proposal: dirtyJournal } = await journal(dirtyRecovery);
  const dirtyMain = await repo.resolveRevision(dirtyRecovery.repo_path, 'main');
  const unrelated = join(dirtyRecovery.repo_path, 'unreviewed.txt');
  writeFileSync(unrelated, 'Never sweep this into main');
  await rejects('unexpected dirty files block recovery and new writes', () => proposals.commitDocument(dirtyRecovery, 'Must not proceed'), proposals.ApprovalRecoveryBlocked);
  check('blocked recovery neither merges nor closes the proposal', [await repo.resolveRevision(dirtyRecovery.repo_path, 'main'), intentFor(dirtyJournal).phase, proposals.getProposal(dirtyJournal.id).state], [dirtyMain, 'prepared', 'draft']);
  check('blocked recovery preserves unrelated work', readFileSync(unrelated, 'utf8'), 'Never sweep this into main');
  const waitingDecision = store.saveDecision(dirtyRecovery.id, { chapterKey: 'overview', statement: 'Await recovery', rationale: '', source: 'agent' });
  await rejects('a choice blocked before application does not claim it was saved', () => decisionsApi.POST(event({ projectId: dirtyRecovery.id, id: waitingDecision.id, action: 'confirm' })), e => e.status === 503 && e.body.message.includes('has not been recorded'));
  check('recovery blocks decision mutation before confirmation', store.getDecision(waitingDecision.id).status, 'proposed');
  rmSync(unrelated);
  await proposals.ensureWorkingProposal(dirtyRecovery);
  check('resolving dirty work allows forward recovery', intentFor(dirtyJournal).phase, 'complete');

  const unfinishedMerge = fixtureProject('recovery-unfinished-merge');
  store.updateChapterState(unfinishedMerge.id, 'overview', { contentMd: 'Unfinished merge fixture' });
  await proposals.commitDocument(unfinishedMerge, 'Before unfinished merge');
  const { proposal: unfinishedProposal, reviewed: unfinishedReview } = await journal(unfinishedMerge);
  const mergeHead = join(unfinishedMerge.repo_path, '.git/MERGE_HEAD');
  writeFileSync(mergeHead, unfinishedReview.proposalRevision + '\n');
  check('porcelain status alone misses an unfinished clean merge', await repo.hasChanges(unfinishedMerge.repo_path), false);
  await rejects('an unfinished merge blocks approval recovery even with a clean tree', () => proposals.ensureWorkingProposal(unfinishedMerge), proposals.ApprovalRecoveryBlocked);
  check('an unfinished merge cannot be swept into a bundle commit', intentFor(unfinishedProposal).phase, 'prepared');
  rmSync(mergeHead);
  await proposals.ensureWorkingProposal(unfinishedMerge);
  check('a resolved unfinished merge can resume its approval', intentFor(unfinishedProposal).phase, 'complete');

  const movedBase = fixtureProject('recovery-moved-base');
  store.updateChapterState(movedBase.id, 'overview', { contentMd: 'Authorized base fixture' });
  await proposals.commitDocument(movedBase, 'Authorize against this base');
  const { proposal: movedProposal } = await journal(movedBase);
  const movedGit = simpleGit(movedBase.repo_path);
  await movedGit.checkout('main');
  await movedGit.commit('Unexpected external base change', ['--allow-empty']);
  const foreignMain = await repo.resolveRevision(movedBase.repo_path, 'main');
  await rejects('an unexpected main revision cannot be merged during recovery', () => proposals.ensureWorkingProposal(movedBase), proposals.ApprovalRecoveryBlocked);
  check('a moved base remains untouched and unclosed', [await repo.resolveRevision(movedBase.repo_path, 'main'), intentFor(movedProposal).phase, proposals.getProposal(movedProposal.id).state], [foreignMain, 'prepared', 'draft']);

  console.log('\n--- verification input revisions and identity atomicity ---');
  gateway.streamChat = async function* () { yield { type: 'done', servedBy: 'fixture', outputTokens: 0 }; };
  await verifyApi.POST(event({ projectId: verifyProject.id }));
  const currentReport = store.latestVerification(verifyProject.id);
  check('new coverage records the exact input revision', [currentReport.document_revision, currentReport.stale], [store.documentRevision(verifyProject.id), false]);
  store.updateChapterState(verifyProject.id, 'overview', { contentMd: 'Changed after verification' });
  const staleReport = store.latestVerification(verifyProject.id);
  check('document updates invalidate an earlier clean report', staleReport.stale, true);
  const oldReportHtml = render(ReviewPage, { props: { data: await reviewPage.load({ params: { id: String(verifyProject.id) } }) } }).body;
  check('stale coverage cannot appear clean in the review', oldReportHtml.includes('older document') && !oldReportHtml.includes('nothing flagged'), true);
  const verifyEntered = deferred();
  const finishVerify = deferred();
  gateway.streamChat = async function* () { verifyEntered.resolve(); await finishVerify.promise; yield { type: 'done', servedBy: 'fixture', outputTokens: 0 }; };
  const delayedVerification = verifyApi.POST(event({ projectId: verifyProject.id }));
  const rejectedVerification = rejects('verification rejects a document changed while checking', () => delayedVerification, e => e.status === 409);
  await verifyEntered.promise;
  store.updateChapterState(verifyProject.id, 'security', { contentMd: 'Changed during verification' });
  finishVerify.resolve();
  await rejectedVerification;
  check('a stale verification cannot replace the prior stored report', store.latestVerification(verifyProject.id).id, currentReport.id);

  store.setChapterApplicable(verifyProject.id, 'security', false, 'Not in scope');
  store.saveDecision(verifyProject.id, { chapterKey: 'security', statement: 'An excluded assumption', rationale: '', source: 'agent' });
  let scopeCalls = 0;
  gateway.streamChat = async function* (req) {
    scopeCalls++;
    assert.equal(req.system.includes('chapters="overview"'), true, 'Only the in-scope chapter needs a call');
    yield { type: 'done', servedBy: 'fixture', outputTokens: 0 };
  };
  const scopedCheck = await verifyDocument({ chapters: store.projectChapters(verifyProject.id), requirements: store.projectRequirements(verifyProject.id), decisions: store.projectDecisions(verifyProject.id) });
  check('excluded rules do not trigger the cross-document call', scopeCalls, 1);
  check('excluded assumptions do not affect in-scope coverage', [scopedCheck.checked, scopedCheck.failed, scopedCheck.assumptionsOutstanding], [['overview'], [], 0]);

  globalThis.specmanTestClaims = { iss: process.env.OIDC_ISSUER, sub: 'atomic-identity', preferred_username: 'atomic-user' };
  const usersBefore = store.countUsers();
  database.exec(`CREATE TRIGGER interrupt_identity_insert BEFORE INSERT ON oidc_identities
    WHEN NEW.subject = 'atomic-identity' BEGIN SELECT RAISE(ABORT, 'Simulated identity failure'); END;`);
  await rejects('an interrupted identity link rolls back the new account', () => completeLogin(new URL('https://fixture.invalid/callback'), 'state', 'verifier'), /Simulated identity failure/);
  check('identity failure leaves no orphan account', store.countUsers(), usersBefore);
  database.exec('DROP TRIGGER interrupt_identity_insert');
  const concurrentLogins = await Promise.all([1, 2].map(() => completeLogin(new URL('https://fixture.invalid/callback'), 'state', 'verifier')));
  check('concurrent sign-in resumes the same authoritative identity', concurrentLogins[0].id, concurrentLogins[1].id);
  check('concurrent registration creates one ordinary account', [store.countUsers(), concurrentLogins[0].is_admin], [usersBefore + 1, 0]);
  assert.throws(() => database.prepare('INSERT INTO oidc_identities (user_id,issuer,subject) VALUES (?,?,?)')
    .run(1, process.env.OIDC_ISSUER, 'atomic-identity'), /UNIQUE/);
  check('a duplicate authoritative identity cannot replace its ordinary owner', database.prepare('SELECT user_id FROM oidc_identities WHERE issuer = ? AND subject = ?').get(process.env.OIDC_ISSUER, 'atomic-identity').user_id, concurrentLogins[0].id);
} finally {
  globalThis.fetch = realFetch;
  gateway.streamChat = realStream;
  gateway.callWithTools = realTools;
  database.close();
  rmSync(root, { recursive: true, force: true });
}
console.log(`\n${passed} boundary checks passed`);
