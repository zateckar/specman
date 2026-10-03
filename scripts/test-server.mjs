/** Boundary regressions with real SQLite/Git and simulated external services. */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
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
// Blank, not absent: absent, the real key in `.env` is read, and a fallback test
// would ask Google for real.
process.env.GEMINI_API_KEY = '';
process.env.GEMINI_BASE_URL = 'https://gemini.invalid/v1beta';
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
        export async function authorizationCodeGrant(config, url, checks) {
          globalThis.specmanTestChecks = checks;
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
const auth = await import('../src/lib/server/auth/index.ts');
const { GatewayProvider, ModelProvider, gateway } = await import('../src/lib/server/llm/gateway.ts');
const { GeminiProvider } = await import('../src/lib/server/llm/gemini.ts');
const budgets = await import('../src/lib/server/llm/budgets.ts');
const loginPage = await import('../src/routes/login/+page.server.ts');
const logout = await import('../src/routes/logout/+server.ts');
const { verifyDocument } = await import('../src/lib/server/llm/verification.ts');
const { sameStatement } = await import('../src/lib/server/llm/requirements.ts');
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
/** What the colleague wrote, out of the state a chat request wraps around it. */
const said = (req) => /THE COLLEAGUE'S MESSAGE\n\n([\s\S]*?)(?:\n\n---\n\n|$)/.exec(req.messages.at(-1).content)?.[1];
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
  const login = () => completeLogin(new URL('https://fixture.invalid/callback'), 'state', 'verifier', 'nonce');
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
  check('the ID token is bound to the nonce of this attempt', globalThis.specmanTestChecks.expectedNonce, 'nonce');

  // The mirror: a header naming a company sign-in account is not that subject.
  const proxyHeaders = (name) => (headerName) => headerName.toLowerCase() === 'x-forwarded-user' ? name : null;
  check('the proxy cannot adopt a company sign-in account', auth.userForProxyHeaders(proxyHeaders('new-colleague')), null);
  check('but resumes an account the proxy made', auth.userForProxyHeaders(proxyHeaders('proxy-colleague'))?.username, 'proxy-colleague');
  // Promoted on the people page. Proxy sign-in on is the operator vouching for
  // the header, so the rights come with it.
  database.prepare("UPDATE users SET is_admin = 1 WHERE username = 'proxy-colleague'").run();
  check('rights granted on the people page come with the header', auth.userForProxyHeaders(proxyHeaders('proxy-colleague'))?.is_admin, 1);
  database.prepare("UPDATE users SET is_admin = 0 WHERE username = 'proxy-colleague'").run();

  // Switching from the gateway's account to one's own.
  auth.createUser({ username: 'switch-admin', password: 'own password', isAdmin: true });
  check('a header naming a password account is still refused', auth.userForProxyHeaders(proxyHeaders('switch-admin')), null);
  const viaGateway = { user: auth.userForProxyHeaders(proxyHeaders('proxy-colleague')), viaProxy: true };
  const signInAt = new URL('https://fixture.invalid/login?next=/projects/1');
  const signInPage = await loginPage.load({ locals: viaGateway, url: signInAt });
  check('the gateway\'s colleague reaches the sign-in page, which names them',
    [signInPage.gatewayUser, signInPage.next], [viaGateway.user.display_name, '/projects/1']);
  const signedIn = { user: store.getUserByUsername('switch-admin'), viaProxy: false };
  check('someone who signed in here is sent on', (await Promise.resolve(loginPage.load({ locals: signedIn, url: signInAt })).catch((thrown) => thrown)).status, 303);
  const jar = new Map();
  const cookies = {
    get: (name) => jar.get(name), set: (name, value) => jar.set(name, value), delete: (name) => jar.delete(name)
  };
  const switched = await loginPage.actions.default({
    request: new Request('https://fixture.invalid/login', {
      method: 'POST', body: new URLSearchParams({ username: 'switch-admin', password: 'own password', next: '/projects/1' })
    }),
    cookies, getClientAddress: () => '10.0.0.4', locals: viaGateway
  }).catch((thrown) => thrown);
  check('behind the gateway, a password signs in to its own account', [switched.status, switched.location], [303, '/projects/1']);
  check('and the session is that account, with its rights', auth.userForSession(jar.get(auth.SESSION_COOKIE))?.is_admin, 1);
  const session = jar.get(auth.SESSION_COOKIE);
  const signedOut = await Promise.resolve(logout.POST({ cookies })).catch((thrown) => thrown);
  check('signing out leads to the sign-in page', [signedOut.status, signedOut.location], [303, '/login']);
  check('and ends the session, handing back to the gateway', [jar.has(auth.SESSION_COOKIE), auth.userForSession(session)], [false, null]);

  // A name with no password costs the same hash as a wrong password, so the
  // reply does not say which names exist.
  auth.createUser({ username: 'timed-colleague', password: 'correct horse' });
  check('a password account signs in', (await auth.login('timed-colleague', 'correct horse'))?.username, 'timed-colleague');
  check('a wrong password does not', await auth.login('timed-colleague', 'wrong'), null);
  const timed = async (name) => { const start = performance.now(); await auth.login(name, 'wrong'); return performance.now() - start; };
  const known = await timed('timed-colleague');
  const unknown = await timed('nobody-at-all');
  check('an unknown name still costs a hash', unknown > known / 4, true);

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
  globalThis.fetch = async () => new Response(frame({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: budgets.DEFAULT_BUDGET } }) + stopFrame);
  await rejects('silence that spent the whole budget is not a clean answer', () => readStream(), /ran out of room/);
  globalThis.fetch = async () => new Response(textFrame('complete') + 'data: [DONE]\n\n');
  check('an explicit gateway DONE sentinel also completes', (await readStream()).map((e) => e.type), ['text', 'done']);

  // As the live gateway streamed a call to read a chapter on 2026-10-03.
  const sentBodies = [];
  globalThis.fetch = async (_url, init) => {
    sentBodies.push(JSON.parse(init.body));
    return new Response(
      frame({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'call-1', name: 'read_chapter', input: {} } }) +
      frame({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"key": ' } }) +
      frame({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"security"}' } }) +
      frame({ type: 'content_block_stop', index: 1 }) +
      frame({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 78 } }) + stopFrame);
  };
  const toolEvents = [];
  for await (const item of new GatewayProvider().streamChat({ ...request, tools: [{ name: 'read_chapter', description: 'd', input_schema: { type: 'object', properties: {}, required: [] } }] })) toolEvents.push(item);
  check('a tool called mid-stream arrives whole, as its own event', toolEvents.filter((e) => e.type !== 'done'), [{ type: 'tool_call', id: 'call-1', name: 'read_chapter', input: { key: 'security' } }]);
  check('and the tools are sent only when there are some', [sentBodies[0].tools?.[0]?.name, 'tools' in (await (async () => { await readStream().catch(() => {}); return sentBodies[1]; })())], ['read_chapter', false]);

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
  const reopened = store.getChapter(decisionProject.id, 'overview');
  check('a rejected assumption puts its chapter back in progress', reopened.status, 'in_progress');
  check('with the question at the top of its open questions', reopened.open_questions[0], proposals.questionForRejected(discarded.statement));
  check('and the assistant asks it in that chapter', store.recentMessages(decisionProject.id, 'overview', 1)[0].content, proposals.questionForRejected(discarded.statement));
  check('which reaches the committed proposal too', afterDiscard.chapters.find(c => c.key === 'overview').open_questions[0], proposals.questionForRejected(discarded.statement));
  await rejects('a decision settled in another window is reported as such', () => decisionsApi.POST(event({ projectId: decisionProject.id, id: discarded.id, action: 'discard' })), e => e.status === 409 && e.body.message.includes('another window'));
  const confirmedAt = store.getDecision(decision.id).confirmed_at;
  store.confirmDecision(decisionProject.id, decision.id);
  check('confirming twice keeps the first confirmation time', store.getDecision(decision.id).confirmed_at, confirmedAt);
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
    const slow = said(req) === 'Slow answer';
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

  // What the interviewer is shown, through the real endpoint.
  const interviewed = fixtureProject('whole-document');
  const [target, other] = store.projectChapters(interviewed.id).filter(c => c.key !== 'overview' && c.applicable !== 0 && !c.parent_key);
  store.updateChapterState(interviewed.id, other.key, { contentMd: 'Managers see every booking, with its purpose.' });
  const requests = [];
  gateway.callWithTools = async () => ({ calls: [], text: '', servedBy: 'fixture', attempts: 1 });
  gateway.streamChat = async function* (req) {
    requests.push(req);
    yield { type: 'text', text: `<chapter key="${target.key}">Version ${requests.length}</chapter>Noted.` };
    yield { type: 'done', servedBy: 'fixture', outputTokens: 1 };
  };
  for (const message of ['First', 'Second']) {
    await (await chat.POST(event({ projectId: interviewed.id, chapterKey: target.key, message }))).text();
  }
  check('the interviewer sees what another chapter says, so it can notice a contradiction',
    requests[0].system.includes('Managers see every booking, with its purpose.'), true);
  check('the system prompt is the same on the next turn, though the chapter and its status changed',
    [requests[0].system === requests[1].system, store.getChapter(interviewed.id, target.key).content_md], [true, 'Version 2']);
  check('the chapter as it reads now travels with the message',
    [requests[1].messages.at(-1).content.includes('Version 1'), said(requests[1])], [true, 'Second']);
  check('earlier turns are replayed as they were said', requests[1].messages.map(m => m.content).slice(0, 2), ['First', 'Noted.']);
  check('and the transcript keeps only the colleague\'s words',
    store.recentMessages(interviewed.id, target.key, 20).filter(m => m.role === 'user').map(m => m.content), ['First', 'Second']);
  for (let i = 0; i < 10; i++) {
    store.addMessage(interviewed.id, target.key, 'user', `Earlier ${i}`);
    store.addMessage(interviewed.id, target.key, 'assistant', `Reply ${i}`);
  }
  await (await chat.POST(event({ projectId: interviewed.id, chapterKey: target.key, message: 'Third' }))).text();
  check('a long conversation replays a window starting on a step, at least sixteen long',
    [requests[2].messages.length, requests[2].messages[0].content], [17, 'Earlier 2']);
  check('a reply that names no other chapter is not asked about', requests.length, 3);

  // A reply that says it corrected another chapter and wrote no block for it.
  const asked = [];
  const claimTurn = async (repairText) => {
    gateway.streamChat = async function* (req) {
      const repairing = req.messages.at(-1).content.startsWith('FROM SPECMAN, NOT FROM THE COLLEAGUE');
      asked.push(repairing ? req.messages.at(-1).content : 'turn');
      yield { type: 'text', text: repairing ? repairText : `I corrected the ${other.title} chapter to match.` };
      yield { type: 'done', servedBy: 'fixture', outputTokens: 1 };
    };
    return (await chat.POST(event({ projectId: interviewed.id, chapterKey: target.key, message: 'Managers see totals only.' }))).text();
  };
  const repaired = await claimTurn(`<chapter key="${other.key}">Managers see totals only.</chapter>`);
  check('the server asks for the chapter a reply said it changed, by key',
    [asked.length, asked[1]?.includes(`(key: ${other.key})`)], [2, true]);
  check('and saves what comes back, as though the reply had carried it',
    [store.getChapter(interviewed.id, other.key).content_md, repaired.includes(`event: chapter\ndata: {"key":"${other.key}"`)], ['Managers see totals only.', true]);
  asked.length = 0;
  await claimTurn('');
  check('a reply that only mentioned the chapter changes nothing when asked', [asked.length, store.getChapter(interviewed.id, other.key).content_md], [2, 'Managers see totals only.']);
  asked.length = 0;
  await claimTurn(`<chapter key="${target.key}">Sneaked in.</chapter>`);
  check('and the follow-up cannot write anything but the chapters it was asked for', store.getChapter(interviewed.id, target.key).content_md, 'Version 3');

  // A long document: the assistant reads a chapter shown only in part, then writes.
  const filler = (topic) => Array.from({ length: 60 }, (_, i) => `The ${topic} paragraph ${i} starts here. ${'More words that only the whole chapter carries. '.repeat(8)}`).join('\n\n');
  const longDoc = fixtureProject('long-document');
  const [asking, ...rest] = store.projectChapters(longDoc.id).filter(c => c.key !== 'overview' && c.applicable !== 0 && !c.parent_key);
  for (const c of rest) store.updateChapterState(longDoc.id, c.key, { contentMd: `## About\n\n${filler(c.key)}` });
  store.updateChapterState(longDoc.id, rest[0].key, { contentMd: `## About\n\n${filler(rest[0].key)}\n\n## Buried\n\nManagers see every purpose typed.` });
  const longCalls = [];
  gateway.callWithTools = async () => ({ calls: [], text: '', servedBy: 'fixture', attempts: 1 });
  gateway.streamChat = async function* (req) {
    longCalls.push(req);
    if (longCalls.length === 1) {
      yield { type: 'text', text: 'Let me check. ' };
      yield { type: 'tool_call', id: 'r1', name: 'read_chapter', input: { key: rest[0].key } };
    } else {
      yield { type: 'text', text: `<chapter key="${asking.key}">Managers see totals.</chapter>That contradicts "${rest[0].title}"; I corrected it.` };
      yield { type: 'text', text: `<section chapter="${rest[0].key}" heading="Buried">Managers see only totals.</section>` };
    }
    yield { type: 'done', servedBy: 'fixture', outputTokens: 1 };
  };
  const longEvents = await (await chat.POST(event({ projectId: longDoc.id, chapterKey: asking.key, message: 'Managers see totals only.' }))).text();
  check('a long document is shown in part, and the assistant may read the rest',
    [longCalls[0].system.includes('[outline]') || longCalls[0].system.includes('[rules only]'), longCalls[0].tools?.[0]?.name], [true, 'read_chapter']);
  check('what it asked to read is sent back as the chapter as it stands, and the reply goes on',
    [longCalls.length, longCalls[1].messages.at(-1).content[0].type, longCalls[1].messages.at(-1).content[0].content.includes('Managers see every purpose typed.'),
      longCalls[1].messages.at(-2).content.map(b => b.type)], [2, 'tool_result', true, ['text', 'tool_use']]);
  check('the chat says it is reading, by chapter', longEvents.includes(`event: activity\ndata: {"doing":"reading","chapter":"${rest[0].key}"}`), true);
  check('a part written by heading lands there, and the rest of that chapter is kept',
    [store.getChapter(longDoc.id, rest[0].key).content_md.endsWith('## Buried\n\nManagers see only totals.'), store.getChapter(longDoc.id, rest[0].key).content_md.includes('paragraph 59 starts here')], [true, true]);
  check('the reply\'s words before and after the read reach the chat as one', longEvents.includes('Let me check.'), true);
  check('and the transcript keeps the colleague\'s words, not the reading', store.recentMessages(longDoc.id, asking.key, 5).map(m => typeof m.content), ['string', 'string']);

  // A model that only ever reads is stopped, and told so.
  longCalls.length = 0;
  gateway.streamChat = async function* (req) {
    longCalls.push(req);
    yield { type: 'tool_call', id: `r${longCalls.length}`, name: 'read_chapter', input: { key: rest[1].key } };
    yield { type: 'done', servedBy: 'fixture', outputTokens: 1 };
  };
  const endless = await (await chat.POST(event({ projectId: longDoc.id, chapterKey: asking.key, message: 'Anything?' }))).text();
  check('a reply that only reads is given three reads, and is told at the last one to write',
    [longCalls.length, longCalls.at(-1).messages.at(-1).content[0].content.endsWith('Write your reply now, with what you have.)'),
      longCalls.at(-2).messages.at(-1).content[0].content.includes('last reading')], [4, true, false]);
  check('and if it reads again, its reply ends there and says nothing came back', endless.includes('sent nothing back'), true);

  // A part with no heading named is not taken as the chapter's opening.
  gateway.streamChat = async function* () {
    yield { type: 'text', text: `<section chapter="${rest[1].key}">Replacement with no heading.</section>Done.` };
    yield { type: 'done', servedBy: 'fixture', outputTokens: 1 };
  };
  const headless = await (await chat.POST(event({ projectId: longDoc.id, chapterKey: asking.key, message: 'x' }))).text();
  check('a part that names no heading is not saved, and the colleague is told',
    [store.getChapter(longDoc.id, rest[1].key).content_md.startsWith('## About'), headless.includes('could not be filed')], [true, true]);

  // A colleague's reply that writes nothing is not a change to the document.
  const quiet = fixtureProject('quiet-reply');
  const quietEntered = deferred();
  const finishQuiet = deferred();
  const quietVersion = store.documentRevision(quiet.id);
  store.withDocumentRevision(quiet.id, quietVersion, () => {});
  check('a transaction that writes nothing leaves the revision alone', store.documentRevision(quiet.id), quietVersion);
  gateway.streamChat = async function* (req) {
    const slow = said(req) === 'Slow answer';
    if (slow) { quietEntered.resolve(); await finishQuiet.promise; }
    yield { type: 'text', text: slow ? '<chapter key="overview">Slow but valid prose</chapter>Recorded.' : 'Just a question back?' };
    yield { type: 'done', servedBy: 'fixture', outputTokens: 1 };
  };
  const quietSlow = (await chat.POST(event({ projectId: quiet.id, chapterKey: 'overview', message: 'Slow answer' }))).text();
  await quietEntered.promise;
  await (await chat.POST(event({ projectId: quiet.id, chapterKey: 'security', message: 'Talk only' }))).text();
  finishQuiet.resolve();
  const quietEvents = await quietSlow;
  check('a text-only reply does not fail a slower turn', quietEvents.includes('proposed changes were not applied'), false);
  check('so the slower turn is saved', store.getChapter(quiet.id, 'overview').content_md.includes('Slow but valid prose'), true);

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

  console.log('\n--- what a turn files where ---');
  const filing = fixtureProject('filing');
  store.updateChapterState(filing.id, 'overview', { contentMd: 'Kept prose' });
  let seenMessages = [];
  const turn = async (text, chapterKey = 'overview', message = 'An answer') => {
    gateway.streamChat = async function* (req) {
      seenMessages = req.messages;
      yield { type: 'text', text };
      yield { type: 'done', servedBy: 'fixture', outputTokens: 1 };
    };
    return (await chat.POST(event({ projectId: filing.id, chapterKey, message }))).text();
  };
  gateway.callWithTools = async () => { throw new Error('Simulated assessment outage'); };
  await turn('<chapter key="overview"></chapter>Thanks.');
  check('an empty chapter block does not erase the chapter', store.getChapter(filing.id, 'overview').content_md, 'Kept prose');
  await turn('<chapter>Written without a key.</chapter>Done.');
  check('a block with no key writes the chapter under discussion', store.getChapter(filing.id, 'overview').content_md, 'Written without a key.');
  const securityTitle = store.getChapter(filing.id, 'security').title;
  await turn(`<chapter key="${securityTitle}">Filed by its title.</chapter>Done.`);
  check('a block naming the title instead of the key still lands', store.getChapter(filing.id, 'security').content_md, 'Filed by its title.');
  check('a chapter written while its assessment failed is no longer empty', store.getChapter(filing.id, 'security').status, 'in_progress');
  const unfiledEvents = await turn('<chapter key="no-such-chapter">Lost words.</chapter>Done.');
  check('a block for no chapter is reported, not silently dropped', unfiledEvents.includes('could not be filed'), true);
  await turn('<chapter key="overview">Nothing but a block.</chapter>');
  check('a reply with no words is not stored as an empty turn', store.recentMessages(filing.id, 'overview', 1)[0].role, 'user');
  await turn('Here is my next question?');
  check('an empty turn is never sent to the gateway', seenMessages.every((m) => m.content.trim().length > 0), true);
  check('two user turns in a row are sent as one', seenMessages.some((m, i) => i > 0 && seenMessages[i - 1].role === m.role), false);

  const standard = store.saveRequirement(filing.id, { chapterKey: 'security', statement: 'A company rule', scope: 'now', scenarios: [], source: 'standard' });
  await turn(`<requirement ref="${standard.ref}" action="remove"></requirement>Removed.`);
  check('the assistant cannot delete a company standard', store.getRequirement(filing.id, standard.ref)?.statement, 'A company rule');
  const elsewhere = store.saveRequirement(filing.id, { chapterKey: 'security', statement: 'Lives in security', scope: 'now', scenarios: [] });
  await turn(`<requirement ref="${elsewhere.ref}" scope="later">Lives in security, later\nWHEN a\nTHEN b</requirement>Changed.`);
  check('a requirement restated by reference keeps its chapter', [store.getRequirement(filing.id, elsewhere.ref).chapter_key, store.getRequirement(filing.id, elsewhere.ref).scope], ['security', 'later']);

  const setAside = store.projectChapters(filing.id).find((c) => !['overview', 'security'].includes(c.key) && !c.parent_key);
  store.setChapterApplicable(filing.id, setAside.key, false, 'Fixture triage');
  await turn(`<chapter key="${setAside.key}">It applies after all.</chapter>Done.`);
  check('writing into a set-aside chapter brings it back into scope', store.getChapter(filing.id, setAside.key).applicable, 1);

  // Clicking an open question stores it as the assistant's turn; the answer follows.
  const splitChapter = store.projectChapters(filing.id).find((c) => c.is_dynamic && !c.parent_key);
  store.applySectionPlan(filing.id, splitChapter, [{ key: 'booking', title: 'Booking a car' }, { key: 'returns', title: 'Returning a car' }]);
  store.updateChapterState(filing.id, 'returns', { contentMd: 'Already written returns.' });
  await turn(`<chapter key="${splitChapter.key}">Intro.\n\n## Booking a car\nPick a day.\n\n## Returning a car\nOverwrite attempt.</chapter>Done.`, splitChapter.key);
  check('prose written back into a split chapter is filed into its empty section', store.getChapter(filing.id, 'booking').content_md, 'Pick a day.');
  check('but never over a section already written', store.getChapter(filing.id, 'returns').content_md, 'Already written returns.');
  check('and what was filed leaves the parent', store.getChapter(filing.id, splitChapter.key).content_md.includes('Pick a day.'), false);

  const untouched = store.projectChapters(filing.id).find((c) => !['overview', 'security', setAside.key, splitChapter.key].includes(c.key) && !c.parent_key);
  store.addMessage(filing.id, untouched.key, 'assistant', 'Who may see the backups?');
  await turn('Recorded.', untouched.key, 'Only the fleet office');
  check('the question a clicked open question asked reaches the model',
    [seenMessages.length, seenMessages[0].role, seenMessages[1].content, said({ messages: seenMessages })],
    [3, 'user', 'Who may see the backups?', 'Only the fleet office']);

  gateway.streamChat = async function* () { throw Object.assign(new Error('Gateway stream failed with 502'), { name: 'GatewayError' }); };
  const plainFailure = await (await chat.POST(event({ projectId: filing.id, chapterKey: 'overview', message: 'Again' }))).text();
  check('a gateway failure reaches the user in plain words', plainFailure.includes('cannot be reached') && !plainFailure.includes('502'), true);

  // Rules and decisions that cannot be placed are reported like a chapter block is.
  const beforeOrphans = [store.projectRequirements(filing.id).length, store.projectDecisions(filing.id).length];
  const orphanEvents = await turn('<requirement>Every booking is confirmed by email.\nWHEN booked\nTHEN mailed</requirement><decision source="agent">Email only.\nWhy: simplest.</decision>Noted.', null);
  check('a rule from the whole-document conversation with no chapter is reported', orphanEvents.includes('could not be filed'), true);
  check('and nothing is filed under a guess', [store.projectRequirements(filing.id).length, store.projectDecisions(filing.id).length], beforeOrphans);
  await turn(`<requirement chapter="${securityTitle}">Only staff can see the bookings.\nWHEN a visitor looks\nTHEN nothing is shown</requirement>Noted.`, null);
  check('a rule naming its chapter by title is filed there', store.chapterRequirements(filing.id, 'security').some(r => r.statement === 'Only staff can see the bookings.'), true);
  await turn('<requirement>Only staff can see the bookings\nWHEN a visitor looks\nTHEN nothing is shown</requirement>Noted.', 'security');
  check('the same rule restated without its reference is not copied', store.chapterRequirements(filing.id, 'security').filter(r => sameStatement(r.statement, 'Only staff can see the bookings')).length, 1);

  // The model handed back the choice and labelled it the user's anyway.
  await turn('<decision source="user">Bookings are kept for a year.\nWhy: long enough for audits.</decision>Done.', 'security', 'I don’t know, you decide.');
  check('a choice handed back is not stored as the user’s', store.projectDecisions(filing.id).find(d => d.statement === 'Bookings are kept for a year.')?.status, 'proposed');

  // Nothing at all back from a successful call.
  const silentEvents = await turn('', 'overview', 'Anything?');
  check('an empty reply is reported rather than taken as an answer', silentEvents.includes('sent nothing back'), true);

  // A section named after a chapter that already exists.
  const splitting = fixtureProject('section-keys');
  const growing = store.projectChapters(splitting.id).find(c => c.is_dynamic && !c.parent_key);
  const taken = store.projectChapters(splitting.id).find(c => c.key !== growing.key && !c.parent_key).key;
  gateway.streamChat = async function* () {
    yield { type: 'text', text: `<subchapters>${taken}: A section named like a chapter\n${growing.key}: And one like its parent\nbooking: Booking a car</subchapters>Split.` };
    yield { type: 'done', servedBy: 'fixture', outputTokens: 1 };
  };
  const splitEvents = await (await chat.POST(event({ projectId: splitting.id, chapterKey: growing.key, message: 'Split it' }))).text();
  const sections = store.projectChapters(splitting.id).filter(c => c.parent_key === growing.key).map(c => c.key);
  check('a section key another chapter has does not crash the reply', [splitEvents.includes('event: error'), sections.length], [false, 3]);
  check('it is filed under the parent instead', sections.includes(`${growing.key}-${taken}`), true);
  await (await chat.POST(event({ projectId: splitting.id, chapterKey: growing.key, message: 'Split it again' }))).text();
  check('and the same plan again finds the same sections', store.projectChapters(splitting.id).filter(c => c.parent_key === growing.key).length, 3);

  // An overloaded backend said so inside the stream, before any text.
  let streamCalls = 0;
  globalThis.fetch = async () => {
    streamCalls += 1;
    return new Response(streamCalls === 1
      ? frame({ type: 'error', error: { type: 'overloaded_error' } })
      : textFrame('Recovered') + stopFrame);
  };
  const recovered = (await readStream()).filter(e => e.type === 'text').map(e => e.text).join('');
  check('an in-stream overload before any text is retried', [streamCalls, recovered], [2, 'Recovered']);
  globalThis.fetch = realFetch;

  console.log('\n--- Gemini, and falling back to it ---');
  {
    const geminiChunk = (parts, extra = {}) => frame({ candidates: [{ content: { role: 'model', parts }, ...extra }], modelVersion: 'gemini-fixture-2' });
    const asked = [];
    let primary = () => new Response('{"error":"unauthorised"}', { status: 401 });
    let gemini = () => new Response(geminiChunk([{ text: 'From ' }]) + geminiChunk([{ text: 'Gemini' }], { finishReason: 'STOP' }));
    globalThis.fetch = async (url, init) => {
      const to = String(url).startsWith('https://gemini.invalid') ? 'gemini' : 'primary';
      asked.push({ to, url: String(url), headers: init.headers, body: JSON.parse(init.body) });
      return to === 'gemini' ? gemini() : primary();
    };
    const read = async (provider) => {
      const events = [];
      for await (const item of provider.streamChat({ system: 'Be brief.', messages: [{ role: 'user', content: 'Hello' }] })) events.push(item);
      return events;
    };
    const text = (events) => events.filter((e) => e.type === 'text').map((e) => e.text).join('');
    const fresh = () => new ModelProvider(new GatewayProvider(() => !process.env.GEMINI_API_KEY), new GeminiProvider());
    process.env.GEMINI_API_KEY = 'gemini-fixture';

    const alone = await read(new GeminiProvider());
    check('Gemini streams an answer', text(alone), 'From Gemini');
    check('and says which model served it', alone.at(-1), { type: 'done', servedBy: 'gemini-fixture-2', outputTokens: 0 });
    check('asked at its streaming endpoint, with its own key',
      [asked[0].url.endsWith(':streamGenerateContent?alt=sse'), asked[0].headers['x-goog-api-key']], [true, 'gemini-fixture']);
    check('with the system prompt as an instruction', asked[0].body.systemInstruction, { parts: [{ text: 'Be brief.' }] });

    asked.length = 0;
    for await (const _ of new GeminiProvider().streamChat({
      messages: [
        { role: 'user', content: 'Managers see totals.' },
        { role: 'assistant', content: [{ type: 'text', text: 'Let me check.' }, { type: 'tool_use', id: 'r1', name: 'read_chapter', input: { key: 'users' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'r1', content: 'Managers see every booking.' }] }
      ],
      tools: [{ name: 'read_chapter', description: 'd', input_schema: { type: 'object', properties: {}, required: [] } }]
    })) { /* drained */ }
    check('Gemini, asked part-way through a reply that read, is given what was read as text and no tools',
      [asked[0].body.contents.map((c) => c.parts[0].text), 'tools' in asked[0].body],
      [['Managers see totals.', 'Let me check.\n\n(read_chapter {"key":"users"})', 'Managers see every booking.'], false]);

    gemini = () => new Response(geminiChunk([{ text: 'Half a' }]));
    await rejects('a Gemini stream that never says how it finished is not complete', () => read(new GeminiProvider()), /before it was complete/);
    gemini = () => new Response(geminiChunk([{ text: 'Half a' }], { finishReason: 'MAX_TOKENS' }));
    await rejects('nor one that ran out of budget', () => read(new GeminiProvider()), /ran out of room/);
    gemini = () => new Response(geminiChunk([], { finishReason: 'SAFETY' }));
    await rejects('and a refusal is not an empty answer', () => read(new GeminiProvider()), /declined/);

    gemini = () => Response.json({
      candidates: [{ content: { parts: [{ functionCall: { name: 'record', args: { status: 'complete' } } }] }, finishReason: 'STOP' }],
      modelVersion: 'gemini-fixture-2'
    });
    const tool = await new GeminiProvider().callWithTools({
      messages: [{ role: 'user', content: 'Record it' }],
      tools: [{ name: 'record', description: 'Record', input_schema: { type: 'object', properties: { status: { type: 'string' } }, required: ['status'] } }],
      forceTool: 'record'
    });
    check('a forced Gemini tool call comes back as a tool call', [tool.calls, tool.servedBy], [[{ name: 'record', input: { status: 'complete' } }], 'gemini-fixture-2']);
    check('asked to use that tool and no other', asked.at(-1).body.toolConfig.functionCallingConfig.allowedFunctionNames, ['record']);

    gemini = () => new Response(geminiChunk([{ text: 'Answered by Gemini' }], { finishReason: 'STOP' }));
    asked.length = 0;
    const models = fresh();
    check('a primary that refuses is answered by Gemini', text(await read(models)), 'Answered by Gemini');
    check('after asking the primary once', asked.map((a) => a.to), ['primary', 'gemini']);
    asked.length = 0;
    await read(models);
    check('the next call goes to Gemini straight away', asked.map((a) => a.to), ['gemini']);

    asked.length = 0;
    primary = () => new Response(textFrame('From the primary') + stopFrame);
    check('a working primary answers itself', text(await read(fresh())), 'From the primary');
    check('and Gemini is not asked', asked.map((a) => a.to), ['primary']);

    asked.length = 0;
    primary = () => new Response(textFrame('<chapter key="overview">Half') + frame({ type: 'error', error: { type: 'invalid_request_error' } }));
    await rejects('a primary that fails mid-answer is not answered again elsewhere', () => read(fresh()), /interrupted/);
    check('so Gemini is never asked to repeat it', asked.map((a) => a.to), ['primary']);

    // The primary reasons until its budget is gone; Gemini's key is refused.
    const { describeFailure } = await import('../src/lib/server/llm/failures.ts');
    const noRoom = () => new Response(frame({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }) + stopFrame);
    const refusedKey = () => new Response('{"error":{"code":401,"status":"UNAUTHENTICATED"}}', { status: 401 });
    primary = noRoom;
    gemini = refusedKey;
    asked.length = 0;
    const warned = [];
    const realWarn = console.warn;
    console.warn = (...parts) => { warned.push(parts.join(' ')); };
    const outOfRoomModels = fresh();
    let thrown;
    try { await read(outOfRoomModels); } catch (cause) { thrown = cause; } finally { console.warn = realWarn; }
    check('when the primary runs out of room and Gemini fails too, the caller is told it ran out of room',
      [asked.map((a) => a.to), /ran out of room/.test(thrown?.message), describeFailure(thrown).startsWith('That was more than the assistant could write')],
      [['primary', 'gemini'], true, true]);
    check('and Gemini\'s failure still reaches the log', warned.some((line) => /Gemini failed too \(.*401.*\)/.test(line)), true);
    asked.length = 0;
    primary = () => new Response(textFrame('Smaller, from the primary') + stopFrame);
    check('a primary that ran out of room is not rested: the next call asks it first',
      [text(await read(outOfRoomModels)), asked.map((a) => a.to)], ['Smaller, from the primary', ['primary']]);

    // Gemini asked first while a refusing primary rests: its running out of room
    // is reported, though the primary failed after it.
    const resting = fresh();
    primary = () => new Response('{"error":"unauthorised"}', { status: 401 });
    gemini = () => new Response(geminiChunk([{ text: 'Answered by Gemini' }], { finishReason: 'STOP' }));
    await read(resting);
    gemini = () => new Response(geminiChunk([], { finishReason: 'MAX_TOKENS' }));
    asked.length = 0;
    await rejects('with the primary resting, Gemini running out of room is reported over the refusal after it',
      () => read(resting), /Gemini ran out of room/);
    check('asked in that order', asked.map((a) => a.to), ['gemini', 'primary']);
    gemini = refusedKey;
    await rejects('when neither ran out of room, the last failure is reported, as before', () => read(fresh()), /Gemini stream failed with 401/);
    gemini = () => new Response(geminiChunk([{ text: 'Answered by Gemini' }], { finishReason: 'STOP' }));

    const url = process.env.LLM_URL;
    delete process.env.LLM_URL;
    asked.length = 0;
    check('with no primary configured, Gemini answers', text(await read(fresh())), 'Answered by Gemini');
    check('and the primary is not tried', asked.map((a) => a.to), ['gemini']);
    process.env.GEMINI_API_KEY = '';
    await rejects('with neither, the call says nothing is set up', () => read(fresh()), (cause) => cause.name === 'NoModelConfigured');
    process.env.LLM_URL = url;
    globalThis.fetch = realFetch;
  }

  // A reply whose changes are refused leaves no claim in the transcript.
  const refused = fixtureProject('refused-reply');
  const refusedEntered = deferred();
  const finishRefused = deferred();
  gateway.streamChat = async function* () {
    refusedEntered.resolve(); await finishRefused.promise;
    yield { type: 'text', text: '<chapter key="overview">Late prose</chapter>I have recorded that.' };
    yield { type: 'done', servedBy: 'fixture', outputTokens: 1 };
  };
  const refusedBody = (await chat.POST(event({ projectId: refused.id, chapterKey: 'overview', message: 'Slow' }))).text();
  await refusedEntered.promise;
  store.updateChapterState(refused.id, 'overview', { contentMd: 'Someone else wrote first' });
  finishRefused.resolve();
  check('a refused reply reports the conflict', (await refusedBody).includes('proposed changes were not applied'), true);
  check('and is not kept in the transcript as though it were recorded', store.recentMessages(refused.id, 'overview', 5).some(m => m.content.includes('I have recorded that')), false);

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
  await rejects('an interrupted identity link rolls back the new account', () => completeLogin(new URL('https://fixture.invalid/callback'), 'state', 'verifier', 'nonce'), /Simulated identity failure/);
  check('identity failure leaves no orphan account', store.countUsers(), usersBefore);
  database.exec('DROP TRIGGER interrupt_identity_insert');
  const concurrentLogins = await Promise.all([1, 2].map(() => completeLogin(new URL('https://fixture.invalid/callback'), 'state', 'verifier', 'nonce')));
  check('concurrent sign-in resumes the same authoritative identity', concurrentLogins[0].id, concurrentLogins[1].id);
  check('concurrent registration creates one ordinary account', [store.countUsers(), concurrentLogins[0].is_admin], [usersBefore + 1, 0]);
  assert.throws(() => database.prepare('INSERT INTO oidc_identities (user_id,issuer,subject) VALUES (?,?,?)')
    .run(1, process.env.OIDC_ISSUER, 'atomic-identity'), /UNIQUE/);
  check('a duplicate authoritative identity cannot replace its ordinary owner', database.prepare('SELECT user_id FROM oidc_identities WHERE issuer = ? AND subject = ?').get(process.env.OIDC_ISSUER, 'atomic-identity').user_id, concurrentLogins[0].id);

  console.log('\n--- storage that is run once and kept ---');
  check('each one-off repair is recorded as done',
    database.prepare("SELECT name FROM migrations WHERE name IN ('file-section-content','drop-navigation-questions') ORDER BY name").all().map((row) => row.name),
    ['drop-navigation-questions', 'file-section-content']);
  check('a busy database is waited for rather than refused', database.prepare('PRAGMA busy_timeout').get().timeout, 5000);
  const firstTemplateChapter = store.templateChapters(store.defaultTemplate().id)[0];
  store.updateTemplateChapter(firstTemplateChapter.id, { goal: '' });
  // A second boot, in its own process, against the same file — which is what a restart is.
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['--import', new URL('./ts-resolve.mjs', import.meta.url).href, '--input-type=module', '-e',
    `const s = await import(${JSON.stringify(new URL('../src/lib/server/db/index.ts', import.meta.url).href)}); s.db().close();`],
    { env: process.env, stdio: 'pipe' });
  check('a goal an administrator cleared is not written back at the next start',
    store.templateChapters(store.defaultTemplate().id)[0].goal, '');
  const migratedProject = fixtureProject('migrated-document');
  database.prepare('INSERT INTO migrated_documents (project_id, summary) VALUES (?, ?)').run(migratedProject.id, 'Moved section text');
  check('the repair is listed until it reaches the repository',
    store.projectsMigratedAtStartup().some((entry) => entry.projectId === migratedProject.id), true);
  await proposals.commitDocument(migratedProject, 'Write the repaired document');
  check('and not after',
    store.projectsMigratedAtStartup().some((entry) => entry.projectId === migratedProject.id), false);

  database.exec(`CREATE TRIGGER interrupt_project_chapters BEFORE INSERT ON chapters
    WHEN (SELECT name FROM projects WHERE id = NEW.project_id) = 'half-made' BEGIN SELECT RAISE(ABORT, 'Simulated chapter failure'); END;`);
  assert.throws(() => fixtureProject('half-made'), /Simulated chapter failure/);
  check('an application whose chapters could not be made is not left behind', store.slugExists('half-made'), false);
  database.exec('DROP TRIGGER interrupt_project_chapters');

  console.log('\n--- creating an application ---');
  const home = await import('../src/routes/+page.server.ts');
  const cwd = process.cwd();
  const createForm = (name) => ({ locals: { user: store.getUser(1) }, request: new Request('https://fixture.invalid/?/create', {
    method: 'POST', body: new URLSearchParams({ name, description: '', reach: 'team', personalData: 'no' })
  }) });
  process.chdir(root);
  try {
    // A file where the repositories folder should be: every repository fails.
    writeFileSync(join(root, 'data'), 'not a folder');
    const failed = await home.actions.create(createForm('Doomed tool'));
    check('a repository that cannot be made is answered in words', [failed.status, failed.data.message.startsWith('The application could not be created.')], [503, true]);
    check('and leaves no application behind', store.listProjects().some((p) => p.name === 'Doomed tool'), false);
    rmSync(join(root, 'data'));
    const made = await home.actions.create(createForm('Con')).catch((thrown) => thrown);
    check('a created application goes to its page', made.status, 303);
    const con = store.listProjects().find((p) => p.name === 'Con');
    check('a Windows device name is not used as a folder', con.slug, 'con-app');
    check('and its repository exists', existsSync(join(con.repo_path, '.git')), true);
    const loaded = await home.load({ locals: { user: store.getUser(1) } });
    const card = loaded.projects.find((p) => p.id === con.id);
    check('the home card counts what the index counts', card.total, store.projectChapters(con.id).filter((c) => c.applicable !== 0).length);

    // As stored by the same installation started from another folder.
    database.prepare('UPDATE projects SET repo_path = ? WHERE id = ?').run(join(root, 'elsewhere', 'con-app'), con.id);
    proposals.relocateRepositories();
    check('a repository is followed to where this installation keeps it', store.getProject(con.id).repo_path, con.repo_path);
    rmSync(con.repo_path, { recursive: true, force: true });
    await rejects('a repository that has gone is reported, not started again empty',
      () => proposals.commitDocument(store.getProject(con.id), 'After the loss'), (cause) => cause.name === 'RepositoryMissing');
    check('and nothing was made in its place', existsSync(con.repo_path), false);
    const lostReview = await reviewPage.load({ params: { id: String(con.id) } });
    check('the review page says the history is missing, offering nothing to approve',
      [lostReview.historyMissing, lostReview.reviewed], [true, null]);
  } finally {
    process.chdir(cwd);
  }

  console.log('\n--- a repository picked up where it stopped ---');
  const unborn = join(root, 'unborn-repo');
  mkdirSync(unborn, { recursive: true });
  await simpleGit(unborn).init();
  await repo.ensureRepo(unborn, 'Unborn');
  check('an initialisation that stopped after init is finished', (await simpleGit(unborn).raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim(), 'main');
  const otherBranch = join(root, 'master-repo');
  mkdirSync(otherBranch, { recursive: true });
  const og = simpleGit(otherBranch);
  await og.init(['--initial-branch', 'master']);
  await og.addConfig('user.name', 'Fixture');
  await og.addConfig('user.email', 'fixture@localhost');
  writeFileSync(join(otherBranch, 'README.md'), '# x\n');
  await og.add('.');
  await og.commit('First');
  await repo.ensureRepo(otherBranch, 'Other');
  check('history without main gains main at its first commit',
    (await og.raw(['rev-parse', 'main'])).trim(), (await og.raw(['rev-list', '--max-parents=0', 'HEAD'])).trim());
  check('a folder with no repository has no manifest', await repo.manifestOnBranch(join(root, 'nowhere'), 'main'), null);
  check('a branch with no manifest has none', await repo.manifestOnBranch(otherBranch, 'main'), null);
  await rejects('a branch that does not exist is an error, not an empty manifest',
    () => repo.manifestOnBranch(otherBranch, 'no-such-branch'), Error);

  console.log('\n--- drawing the diagram ---');
  const architectureApi = await import('../src/routes/api/architecture/+server.ts');
  const drawProject = fixtureProject('draw-project');
  const drawEvent = () => event({ projectId: drawProject.id });
  store.saveArchitecture(drawProject.id, [{ id: 'employee', name: 'Employee', type: 'actor', layer: 'business', chapter: '' }], []);
  const { GatewayError } = await import('../src/lib/server/llm/gateway.ts');
  gateway.streamChat = async function* () { throw new GatewayError('Gateway stream failed with 502'); };
  let drawn = await architectureApi.POST(drawEvent());
  const drawingOutage = (await drawn.json()).message;
  check('an outage while drawing is answered in words', [drawn.status, drawingOutage.startsWith('The diagram could not be drawn.')], [503, true]);
  check('and does not claim a message was saved, because none was sent', drawingOutage.includes('message is saved'), false);
  gateway.streamChat = async function* () { yield { type: 'text', text: 'I could not find anything.' }; yield { type: 'done', servedBy: 'fixture', outputTokens: 5 }; };
  drawn = await architectureApi.POST(drawEvent());
  check('nothing usable is refused, not stored', drawn.status, 422);
  check('and the previous picture is still the one shown', store.latestArchitecture(drawProject.id).elements.length, 1);
  store.saveArchitecture(drawProject.id, [], []);
  check('an empty drawing left from before does not hide the good one', store.latestArchitecture(drawProject.id).elements.length, 1);
  gateway.streamChat = async function* (req) {
    const text = req.system.includes('listing the parts')
      ? '<element type="actor" name="Employee" chapter="overview" />\n<element type="service" name="Booking" chapter="x&quot;>" />'
      : '<relation from="Employee" to="Booking" kind="assigned" />';
    yield { type: 'text', text };
    yield { type: 'done', servedBy: 'fixture', outputTokens: 5 };
  };
  drawn = await architectureApi.POST(drawEvent());
  const drawnBody = await drawn.json();
  check('a drawing with something in it is stored', [drawn.status, store.latestArchitecture(drawProject.id).elements.length], [200, 2]);
  check('a chapter link the model made up is dropped', drawnBody.elements.map((e) => e.chapter), ['overview', '']);
  gateway.streamChat = realStream;

  console.log('\n--- administrators editing what every document copies ---');
  const standardsAdmin = await import('../src/routes/admin/standards/+page.server.ts');
  const templatesAdmin = await import('../src/routes/admin/templates/+page.server.ts');
  const adminForm = (url, fields) => ({ locals: { user: store.getUser(1) }, request: new Request(`https://fixture.invalid/${url}`, {
    method: 'POST', body: new URLSearchParams(fields)
  }) });
  const someStandard = store.listStandards()[0];
  const typo = await standardsAdmin.actions.save(adminForm('admin/standards?/save', { id: String(someStandard.id), statement: someStandard.statement, appliesWhen: 'personal-data' }));
  check('a misspelt condition is refused by name', [typo.status, typo.data.message.includes('personal-data')], [400, true]);
  check('and the standard is unchanged', store.listStandards()[0].applies_when, someStandard.applies_when);
  const examples = 'If a colleague signs in, then the company account is used.';
  const narrowed = await standardsAdmin.actions.save(adminForm('admin/standards?/save', { id: String(someStandard.id), statement: someStandard.statement, appliesWhen: 'personal_data', scenarios: examples }));
  check('a known condition is saved', [narrowed.saved, store.listStandards()[0].applies_when], [true, ['personal_data']]);
  const cleared = await standardsAdmin.actions.save(adminForm('admin/standards?/save', { id: String(someStandard.id), statement: someStandard.statement, appliesWhen: '', scenarios: examples }));
  check('a cleared condition means always, not never', [cleared.saved, store.listStandards()[0].applies_when], [true, ['always']]);
  const reworded = await standardsAdmin.actions.save(adminForm('admin/standards?/save', {
    id: String(someStandard.id), statement: 'Colleagues sign in with their company account.', appliesWhen: '',
    scenarios: '- If a colleague opens the application, then they are asked for their company account.\nIf someone outside the company tries, then they are turned away'
  }));
  check('the examples are edited with the wording', [reworded.saved, store.listStandards()[0].scenarios], [true, [
    { when: 'a colleague opens the application', then: 'they are asked for their company account' },
    { when: 'someone outside the company tries', then: 'they are turned away' }
  ]]);
  const unreadable = await standardsAdmin.actions.save(adminForm('admin/standards?/save', { id: String(someStandard.id), statement: 'Changed wording', appliesWhen: '', scenarios: 'WHEN x THEN y' }));
  check('an example not written as "If …, then …" is refused by quoting it', [unreadable.status, unreadable.data.message.includes('WHEN x THEN y')], [400, true]);
  check('and what was typed comes back with the refusal, for that standard', [unreadable.data.id, unreadable.data.values.statement, unreadable.data.values.scenarios], [someStandard.id, 'Changed wording', 'WHEN x THEN y']);
  const noExamples = await standardsAdmin.actions.save(adminForm('admin/standards?/save', { id: String(someStandard.id), statement: 'Changed wording', appliesWhen: '', scenarios: '  \n' }));
  check('a standard is not left without an example', noExamples.status, 400);
  check('and neither refusal changed it', store.listStandards()[0].statement, 'Colleagues sign in with their company account.');
  const shown = await standardsAdmin.load({ locals: { user: store.getUser(1) } });
  check('the page shows the examples in the words they are edited in', shown.standards[0].examples,
    'If a colleague opens the application, then they are asked for their company account.\nIf someone outside the company tries, then they are turned away.');
  const goneStandard = await standardsAdmin.actions.save(adminForm('admin/standards?/save', { id: '987654', statement: 'x' }));
  check('a standard that is gone is an answer, not a crash', goneStandard.status, 400);
  const blankTitle = await templatesAdmin.actions.save(adminForm('admin/templates?/save', { id: String(firstTemplateChapter.id), title: ' ', purpose: 'p' }));
  check('a chapter cannot be given a blank title', blankTitle.status, 400);
  const blankPurpose = await templatesAdmin.actions.save(adminForm('admin/templates?/save', { id: String(firstTemplateChapter.id), title: 'T', purpose: '' }));
  check('or a blank purpose', blankPurpose.status, 400);
  check('and neither was saved', store.templateChapters(store.defaultTemplate().id)[0].title, firstTemplateChapter.title);
  const goneChapter = await templatesAdmin.actions.save(adminForm('admin/templates?/save', { id: '987654', title: 'T', purpose: 'p' }));
  check('a template chapter that is gone is an answer, not a crash', goneChapter.status, 400);

  console.log('\n--- including a chapter that was set aside ---');
  const projectPage = await import('../src/routes/projects/[id]/+page.server.ts');
  const includeProject = fixtureProject('include-project');
  await proposals.ensureWorkingProposal(includeProject);
  store.setChapterApplicable(includeProject.id, 'security', false, 'Not needed for a team tool');
  const beforeInclude = (await simpleGit(includeProject.repo_path).raw(['rev-list', '--count', 'HEAD'])).trim();
  const included = await projectPage.actions.include({ params: { id: String(includeProject.id) }, locals: { user: store.getUser(1) },
    request: new Request('https://fixture.invalid/?/include', { method: 'POST', body: new URLSearchParams({ key: 'security' }) }) });
  check('the user can overrule the triage', [included.included, store.getChapter(includeProject.id, 'security').applicable], ['security', 1]);
  check('and the change is committed like any other', Number((await simpleGit(includeProject.repo_path).raw(['rev-list', '--count', 'HEAD'])).trim()) > Number(beforeInclude), true);

  // Created before the standard was switched on, so nothing was copied then.
  const inheriting = fixtureProject('include-inherits');
  const securityStandard = store.listStandards().find((s) => s.chapter_key === 'security');
  store.updateStandard(securityStandard.id, { active: true, appliesWhen: ['always'] });
  store.setChapterApplicable(inheriting.id, 'security', false, 'Not needed for a team tool');
  const standardRules = () => store.projectRequirements(inheriting.id).filter((r) => r.chapter_key === 'security' && r.source === 'standard');
  check('a chapter set aside holds no standard', standardRules().length, 0);
  store.setChapterApplicable(inheriting.id, 'security', true);
  check('included, it receives the standards filed under it', standardRules().map((r) => r.statement), [securityStandard.statement]);
  store.setChapterApplicable(inheriting.id, 'security', false, 'Not needed after all');
  store.setChapterApplicable(inheriting.id, 'security', true);
  check('and bringing it back again adds nothing twice', standardRules().length, 1);
  store.updateStandard(securityStandard.id, { active: false });

  console.log('\n--- drafting a whole document ---');
  {
  const drafting = await import('../src/lib/server/drafting.ts');
  const draftApi = await import('../src/routes/api/draft/+server.ts');
  const askApi = await import('../src/routes/api/ask/+server.ts');
  const { UNCHECKED_CHAPTER } = await import('../src/lib/server/llm/draft.ts');
  const mockupApi = await import('../src/routes/api/mockup/+server.ts');
  const mockups = await import('../src/lib/server/mockups.ts');
  const overviewApi = await import('../src/routes/api/overview/+server.ts');
  const overviews = await import('../src/lib/server/overviews.ts');
  const admin = store.getUser(1);
  database.prepare("INSERT INTO users (username, display_name) VALUES ('drafting-colleague', 'A colleague')").run();
  const colleague = database.prepare("SELECT * FROM users WHERE username = 'drafting-colleague'").get();

  check('an application from before drafts reads as an interview',
    [store.getProject(999).origin, store.getProject(999).drafted_revision], ['interview', null]);

  // A model that drafts whatever chapter it is asked for — with a rule filed
  // under another chapter and a reference, the same rule twice, and a decision
  // mislabelled as the user's — and can be held, failed or emptied per chapter.
  const stub = { hold: null, holdUnless: null, fail: new Set(), emptyOnce: new Set(), noDecision: new Set(), calls: [] };
  const done = { type: 'done', servedBy: 'fixture', outputTokens: 10 };
  gateway.streamChat = async function* (req) {
    if (!req.system.includes('WRITE THESE, IN THIS ORDER')) { yield done; return; }
    const key = /\(key: ([^)]+)\)/.exec(req.system)[1];
    stub.calls.push({ key, brief: req.system.includes('DID NOT FINISH'), maxTokens: req.maxTokens });
    if (stub.hold && key !== stub.holdUnless) {
      await new Promise((resolve, reject) => {
        stub.hold.promise.then(resolve);
        req.signal?.addEventListener('abort', () => reject(req.signal.reason), { once: true });
      });
    }
    if (stub.fail.has(key)) throw new Error('Simulated drafting outage');
    if (stub.emptyOnce.delete(key)) { yield { type: 'text', text: 'I could not write it.' }; yield done; return; }
    const rule = `<requirement chapter="overview" ref="REQ-001" scope="now">The ${key} rule must hold.\nWHEN it is used\nTHEN it works</requirement>`;
    yield { type: 'text', text: `<chapter key="${key}">Drafted ${key} prose.</chapter>${rule}${rule.replace(' ref="REQ-001"', '')}` +
      (stub.noDecision.has(key) ? '' : `<decision source="user" chapter="overview">Chose ${key}.\nWhy: sensible</decision>`) };
    yield done;
  };
  gateway.callWithTools = async () => ({
    calls: [{ name: 'record_chapter_state', input: { status: 'complete', open_questions: [] } }],
    text: '', servedBy: 'fixture', attempts: 1
  });

  const draftForm = (name, fields = {}) => ({ locals: { user: admin }, request: new Request('https://fixture.invalid/?/create', {
    method: 'POST', body: new URLSearchParams({ name, description: 'Book a pool car for a day', reach: 'team', personalData: 'no', start: 'draft', ...fields })
  }) });
  const settled = async (id) => {
    for (let i = 0; i < 3000 && drafting.isDrafting(id); i++) await new Promise((r) => setTimeout(r, 10));
  };
  const until = async (test) => {
    for (let i = 0; i < 3000 && !test(); i++) await new Promise((r) => setTimeout(r, 10));
  };
  const startDrafted = async (name) => {
    process.chdir(root);
    try {
      const result = await home.actions.create(draftForm(name)).catch((thrown) => thrown);
      if (result.status !== 303) throw new Error(`creating "${name}" answered ${result.status}`);
    } finally {
      process.chdir(cwd);
    }
    return store.listProjects().find((p) => p.name === name);
  };
  const drafted = async (name) => {
    const project = await startDrafted(name);
    await settled(project.id);
    return store.getProject(project.id);
  };
  const isAiDraft = (project) => drafting.draftView(store.getProject(project.id), admin).untouched;
  const statusOf = (thrown) => thrown?.status;
  const leaves = (id) => {
    const chapters = store.projectChapters(id);
    const parents = new Set(chapters.map((c) => c.parent_key).filter(Boolean));
    return chapters.filter((c) => c.applicable !== 0 && !parents.has(c.key));
  };

  process.chdir(root);
  try {
    const nothing = await home.actions.create(draftForm('Draft from nothing', { description: '' }));
    check('a draft with nothing to draft from is refused in words', [nothing.status, /describe/i.test(nothing.data.message)], [400, true]);
    check('and creates nothing', store.listProjects().some((p) => p.name === 'Draft from nothing'), false);
    const long = await home.actions.create(draftForm('Draft at length', { description: 'x'.repeat(2001) }));
    check('a description past the limit is refused', long.status, 400);
  } finally {
    process.chdir(cwd);
  }

  // While the draft runs: everything that would race it waits.
  stub.hold = deferred();
  const running = await startDrafted('Pool car draft');
  check('a draft runs on after the page has gone to the workspace', drafting.isDrafting(running.id), true);
  check('and the page says so, marked as the assistant\'s', [drafting.draftView(running, admin).state, isAiDraft(running)], ['running', true]);
  check('a turn is refused while drafting', statusOf(await chat.POST(event({ projectId: running.id, chapterKey: 'overview', message: 'Mine' })).catch((e) => e)), 409);
  check('and its message was not stored', store.recentMessages(running.id, 'overview').length, 0);
  check('an open question is refused while drafting',
    statusOf(await askApi.POST(event({ projectId: running.id, chapterKey: 'overview', question: 'Who?' })).catch((e) => e)), 409);
  check('a whole-document check is refused while drafting', statusOf(await verifyApi.POST(event({ projectId: running.id })).catch((e) => e)), 409);
  check('the diagram is refused while drafting', statusOf(await architectureApi.POST(event({ projectId: running.id })).catch((e) => e)), 409);
  check('a mock-up is refused while drafting', statusOf(await mockupApi.POST(event({ projectId: running.id })).catch((e) => e)), 409);
  check('an overview is refused while drafting', statusOf(await overviewApi.POST(event({ projectId: running.id })).catch((e) => e)), 409);
  check('approving is refused while drafting', (await approveForm(running)).status, 409);
  check('a second run is refused while one is going', statusOf(await draftApi.POST(event({ projectId: running.id })).catch((e) => e)), 409);
  stub.hold.resolve();
  stub.hold = null;
  await settled(running.id);

  const finished = store.getProject(running.id);
  const chapters = leaves(finished.id);
  check('every chapter that applies was drafted', chapters.every((c) => c.content_md.includes('Drafted')), true);
  check('a chapter the triage set aside was not', store.getChapter(finished.id, 'telemetry').content_md, '');
  check('the Overview was drafted first', stub.calls[0].key, 'overview');
  const decisions = store.projectDecisions(finished.id);
  check('every decision is the assistant\'s and awaits confirmation',
    decisions.every((d) => d.source === 'agent' && d.status === 'proposed'), true);
  check('a decision is filed in the chapter that made it', decisions.find((d) => d.statement === 'Chose security.')?.chapter_key, 'security');
  const securityRules = store.chapterRequirements(finished.id, 'security').filter((r) => r.source !== 'standard');
  check('a rule is filed in its own chapter, once', securityRules.map((r) => r.statement), ['The security rule must hold.']);
  check('the revision chain held to the end', finished.drafted_revision, finished.document_revision);
  check('so the finished draft is untouched and finished',
    [isAiDraft(finished), drafting.draftView(finished, admin).state], [true, 'finished']);
  const history = (await repo.log(finished.repo_path, 50)).map((entry) => entry.message);
  check('each chapter was committed as it landed, under its own name',
    chapters.every((c) => history.includes(`Draft ${c.title}`)), true);
  const securityCommit = (await simpleGit(finished.repo_path).raw(['log', '--grep=^Draft Security$', '--name-only', '--format=']))
    .split('\n').filter((path) => path.startsWith('docs/'));
  check('and a chapter\'s commit holds that chapter alone', securityCommit.length, 1);
  check('the proposal is named for what it holds', proposals.openProposal(finished.id).title, 'Drafted by the assistant');
  const homeData = await home.load({ locals: { user: admin } });
  check('its card carries the mark, and its creator may delete it',
    [homeData.projects.find((p) => p.id === finished.id).draft.untouched, homeData.projects.find((p) => p.id === finished.id).draft.canDelete], [true, true]);
  const colleagueHome = await home.load({ locals: { user: colleague } });
  check('a colleague sees the mark but no way to delete it',
    [colleagueHome.projects.find((p) => p.id === finished.id).draft.untouched, colleagueHome.projects.find((p) => p.id === finished.id).draft.canDelete], [true, false]);
  check('nor can a colleague delete it anyway', await drafting.deleteDraft(finished, colleague), 'forbidden');

  // Looking is not touching.
  await verifyApi.POST(event({ projectId: finished.id }));
  await askApi.POST(event({ projectId: finished.id, chapterKey: 'overview', question: 'Who books the cars?' }));
  check('a whole-document check and an open question asked leave the mark', isAiDraft(finished), true);
  store.saveMockup(finished.id, '<!DOCTYPE html><html><body>Mock</body></html>', store.getProject(finished.id).document_revision);
  check('so does a mock-up kept of it', isAiDraft(finished), true);
  store.saveOverview(finished.id, { pitch: 'Pool cars.' }, store.getProject(finished.id).document_revision);
  check('and an overview kept of it', isAiDraft(finished), true);

  // Anything of a person's ends it, without any of these paths clearing a flag.
  const answered = await drafted('Draft answered');
  gateway.callWithTools = async () => ({ calls: [], text: '', servedBy: 'fixture', attempts: 1 });
  await (await chat.POST(event({ projectId: answered.id, chapterKey: 'overview', message: 'Hello?' }))).text();
  check('an answer that changed nothing ends the mark', isAiDraft(answered), false);
  check('and deleting it is refused', await drafting.deleteDraft(store.getProject(answered.id), admin), 'touched');
  gateway.callWithTools = async () => ({
    calls: [{ name: 'record_chapter_state', input: { status: 'complete', open_questions: [] } }],
    text: '', servedBy: 'fixture', attempts: 1
  });

  const confirmed = await drafted('Draft confirmed');
  await decisionsApi.POST(event({ projectId: confirmed.id, id: store.projectDecisions(confirmed.id)[0].id, action: 'confirm' }));
  check('a confirmed assumption ends the mark', isAiDraft(confirmed), false);

  const discarded = await drafted('Draft discarded');
  await decisionsApi.POST(event({ projectId: discarded.id, id: store.projectDecisions(discarded.id)[0].id, action: 'discard' }));
  check('a rejected assumption ends the mark', isAiDraft(discarded), false);

  const included = await drafted('Draft included');
  await proposals.includeChapter(included, 'telemetry');
  check('an included chapter ends the mark', isAiDraft(included), false);
  check('and the chapter it brought in is offered for drafting, without saying the draft stopped',
    [drafting.draftView(store.getProject(included.id), admin).state, drafting.draftView(store.getProject(included.id), admin).remaining],
    ['undrafted', [store.getChapter(included.id, 'telemetry').title]]);

  const approved = await drafted('Draft approved');
  await approveLatest(approved, proposals.openProposal(approved.id));
  check('an approval ends the mark', isAiDraft(approved), false);

  const together = await drafted('Draft confirmed together');
  const allRight = await (await decisionsApi.POST(event({ projectId: together.id, action: 'confirm-chapter', chapterKey: 'security' }))).json();
  check('a chapter\'s assumptions are confirmed together', [allRight.confirmed,
    store.projectDecisions(together.id).filter((d) => d.chapter_key === 'security' && d.status !== 'confirmed').length], [1, 0]);
  check('in one commit', (await repo.log(together.repo_path, 5)).map((e) => e.message)[0], 'Confirm the assumptions in Security');
  check('and that ends the mark too', isAiDraft(together), false);

  // A person's write between two chapters breaks the chain for good, and a
  // chapter they got to first is not overwritten.
  stub.hold = deferred();
  stub.holdUnless = 'overview';
  const raced = await startDrafted('Draft raced');
  await until(() => drafting.draftView(store.getProject(raced.id), admin).writing.length > 0 &&
    store.getChapter(raced.id, 'overview').content_md !== '');
  store.addMessage(raced.id, 'security', 'user', 'Security is mine to describe.');
  store.confirmDecision(raced.id, store.projectDecisions(raced.id).find((d) => d.chapter_key === 'overview').id);
  stub.hold.resolve();
  stub.hold = null;
  stub.holdUnless = null;
  await settled(raced.id);
  const afterRace = store.getProject(raced.id);
  check('a write between two chapters breaks the chain for good',
    [afterRace.drafted_revision < afterRace.document_revision, isAiDraft(afterRace)], [true, false]);
  check('the draft still finishes the other chapters', store.getChapter(raced.id, 'operations').content_md.includes('Drafted'), true);
  check('but not one a person got to first', store.getChapter(raced.id, 'security').content_md, '');

  // A chapter that fails, one that comes back empty once, and one with no decision.
  stub.fail.add('integration');
  stub.emptyOnce.add('data');
  stub.noDecision.add('licenses');
  stub.calls = [];
  const rough = await drafted('Draft rough');
  stub.fail.clear();
  stub.noDecision.clear();
  check('an empty reply is asked for once more, with more room and briefly',
    stub.calls.filter((c) => c.key === 'data').map((c) => [c.brief, c.maxTokens]), [[false, budgets.DRAFT_BUDGET], [true, budgets.DRAFT_RETRY_BUDGET]]);
  check('and the second answer is kept', store.getChapter(rough.id, 'data').content_md.includes('Drafted'), true);
  check('a chapter whose reply recorded no decision still has one to check',
    store.projectDecisions(rough.id).filter((d) => d.chapter_key === 'licenses').map((d) => [d.statement, d.status]),
    [[UNCHECKED_CHAPTER.statement, 'proposed']]);
  const roughView = drafting.draftView(store.getProject(rough.id), admin);
  check('a failed chapter is named, and the draft reads as stopped',
    [roughView.state, roughView.failed, roughView.untouched], ['stopped', [store.getChapter(rough.id, 'integration').title], true]);
  check('nothing of the failed chapter was saved',
    [store.getChapter(rough.id, 'integration').content_md, store.projectDecisions(rough.id).some((d) => d.chapter_key === 'integration')], ['', false]);
  await (await draftApi.POST(event({ projectId: rough.id }))).json();
  await settled(rough.id);
  check('drafting the rest finishes it, still untouched',
    [drafting.draftView(store.getProject(rough.id), admin).state, isAiDraft(rough)], ['finished', true]);

  // Deleting.
  process.chdir(root);
  const deleteForm = (project, user) => ({ locals: { user }, request: new Request('https://fixture.invalid/?/delete', {
    method: 'POST', body: new URLSearchParams({ project: String(project.id) })
  }) });
  try {
    const refused = await home.actions.delete(deleteForm(answered, admin)).catch((e) => e);
    check('a touched application cannot be deleted from the page', [refused.status, /someone has worked/i.test(refused.data.deleteMessage)], [409, true]);
    const gone = await home.actions.delete(deleteForm(finished, admin)).catch((e) => e);
    check('its creator deletes an untouched draft', [gone.status, store.getProject(finished.id)], [303, undefined]);
    check('and its folder is gone', existsSync(finished.repo_path), false);
    check('with everything stored against it',
      database.prepare('SELECT COUNT(*) AS n FROM decisions WHERE project_id = ?').get(finished.id).n, 0);
    check('its mock-up included', store.latestMockup(finished.id), undefined);
    check('and its overview', store.latestOverview(finished.id), undefined);
    await rejects('a writer queued behind the deletion does not make its history again',
      () => proposals.commitDocument(finished, 'Late check'), (cause) => cause.name === 'ApplicationDeleted');
    check('so no folder came back', existsSync(finished.repo_path), false);
  } finally {
    process.chdir(cwd);
  }

  stub.hold = deferred();
  const midway = await startDrafted('Draft deleted midway');
  check('a draft still being written can be deleted', await drafting.deleteDraft(store.getProject(midway.id), admin), 'deleted');
  check('the draft stopped, and nothing of it is left', [drafting.isDrafting(midway.id), store.getProject(midway.id), existsSync(midway.repo_path)], [false, undefined, false]);
  stub.hold.resolve();
  stub.hold = null;
  await new Promise((r) => setTimeout(r, 50));
  check('nothing it was still doing brought the folder back', existsSync(midway.repo_path), false);

  // A mock-up being made of a draft that is deleted is stopped, once the deletion stands.
  const pictured = await drafted('Draft with a mock-up');
  const summed = await drafted('Draft with an overview');
  const draftingStream = gateway.streamChat;
  gateway.streamChat = async function* (req) {
    await new Promise((resolve, reject) => req.signal?.addEventListener('abort', () => reject(req.signal.reason), { once: true }));
    yield done;
  };
  await mockupApi.POST(event({ projectId: pictured.id }));
  check('a mock-up is being made of a draft', mockups.isMakingMockup(pictured.id), true);
  check('which can still be deleted', await drafting.deleteDraft(store.getProject(pictured.id), admin), 'deleted');
  await until(() => !mockups.isMakingMockup(pictured.id));
  check('and the mock-up being made of it stops', mockups.isMakingMockup(pictured.id), false);
  await overviewApi.POST(event({ projectId: summed.id }));
  check('an overview is being made of a draft', overviews.isMakingOverview(summed.id), true);
  check('which can still be deleted', await drafting.deleteDraft(store.getProject(summed.id), admin), 'deleted');
  await until(() => !overviews.isMakingOverview(summed.id));
  check('and the overview being made of it stops', overviews.isMakingOverview(summed.id), false);
  gateway.streamChat = draftingStream;
  }

  {
  console.log('\n--- making a mock-up ---');
  const mockupApi = await import('../src/routes/api/mockup/+server.ts');
  const mockups = await import('../src/lib/server/mockups.ts');
  const viewRoute = await import('../src/routes/projects/[id]/mockup/view/+server.ts');
  const downloadRoute = await import('../src/routes/projects/[id]/mockup/download/+server.ts');
  const mockupPage = await import('../src/routes/projects/[id]/mockup/+page.server.ts');
  const { MOCKUP_POLICY } = await import('../src/lib/server/llm/mockup.ts');
  const { GatewayError } = await import('../src/lib/server/llm/gateway.ts');
  const admin = store.getUser(1);
  const done = { type: 'done', servedBy: 'fixture', outputTokens: 10 };
  const page = (body) => `<!DOCTYPE html>\n<html lang="en">\n<head><style>main{padding:1em}</style></head>\n<body><main>${body}</main></body>\n</html>`;
  const fromOutside = (body) => page(body).replace('<head>', '<head><script src="https://cdn.tailwindcss.com"></script>');

  // A model that decides the screens, then writes a page in two parts and can be
  // held between them. A reply is a string, or an error to throw.
  const decided = '<screens>\n1. Bookings: this week\'s bookings, one row each.\n</screens>';
  const stub = { replies: [], screens: [], calls: [], screensCalls: [], hold: null, halfway: null, deciding: null, decidingReached: null };
  gateway.streamChat = async function* (req) {
    if (req.system.includes('<screens>')) {
      stub.screensCalls.push({ maxTokens: req.maxTokens, document: req.messages[0].content });
      const reply = stub.screens.length > 0 ? stub.screens.shift() : decided;
      if (stub.deciding) {
        stub.decidingReached?.resolve();
        await stub.deciding.promise;
      }
      if (reply instanceof Error) throw reply;
      yield { type: 'thinking', text: 'Which screens…' };
      yield { type: 'text', text: reply };
      yield done;
      return;
    }
    if (!req.system.includes('clickable mock-up')) { yield done; return; }
    stub.calls.push({
      brief: req.system.includes('COULD NOT BE USED'),
      planned: req.system.includes('already decided'),
      maxTokens: req.maxTokens,
      document: req.messages[0].content
    });
    const reply = stub.replies.shift() ?? page('Default');
    if (reply instanceof Error) throw reply;
    yield { type: 'thinking', text: 'Which screens…' };
    const half = Math.floor(reply.length / 2);
    yield { type: 'text', text: reply.slice(0, half) };
    if (stub.hold) {
      stub.halfway?.resolve();
      await new Promise((resolve, reject) => {
        stub.hold.promise.then(resolve);
        req.signal?.addEventListener('abort', () => reject(req.signal.reason), { once: true });
      });
    }
    yield { type: 'text', text: reply.slice(half) };
    yield done;
  };
  const made = async (id) => {
    for (let i = 0; i < 3000 && mockups.isMakingMockup(id); i++) await new Promise((r) => setTimeout(r, 10));
    return mockups.mockupView({ id });
  };
  const post = (projectId) => mockupApi.POST(event({ projectId })).catch((thrown) => thrown);
  const statusOf = (answered) => answered?.status;
  const routeEvent = (project, headers = {}) => ({ params: { id: String(project.id) }, locals: { user: admin },
    request: new Request('https://fixture.invalid/mockup', { headers }) });

  const sketched = fixtureProject('mockup-project');
  stub.calls = [];
  check('nothing written is refused before any call', [statusOf(await post(sketched.id)), stub.calls.length], [422, 0]);
  check('the page loads with nothing made and nothing running',
    (await mockupPage.load({ params: { id: String(sketched.id) }, locals: { user: admin } })).view,
    { running: false, phase: null, written: 0, retrying: false, problem: null, made: null });
  check('the view says none has been made, in its frame', [(await viewRoute.GET(routeEvent(sketched, { 'sec-fetch-dest': 'iframe' }))).status], [404]);

  store.updateChapterState(sketched.id, 'overview', { contentMd: 'Employees book pool cars by the day.' });
  const before = store.getProject(sketched.id).document_revision;
  stub.deciding = deferred();
  stub.decidingReached = deferred();
  stub.hold = deferred();
  stub.halfway = deferred();
  const started = await post(sketched.id);
  check('a mock-up is started and the request returns at once', [started.status, (await started.json()).running], [202, true]);
  await stub.decidingReached.promise;
  check('it first decides the screens, and says so', mockups.mockupView({ id: sketched.id }).phase, 'planning');
  stub.deciding.resolve();
  stub.deciding = null;
  await stub.halfway.promise;
  const midway = mockups.mockupView({ id: sketched.id });
  check('its progress is the page written so far', [midway.phase, midway.written > 0], ['writing', true]);
  check('asked again meanwhile, it is followed rather than doubled', [(await post(sketched.id)).status, stub.calls.length], [202, 1]);
  stub.hold.resolve();
  stub.hold = null;
  const first = await made(sketched.id);
  check('the screens were decided from the document, with room to think',
    [stub.screensCalls.length, stub.screensCalls[0].document.includes('Employees book pool cars'), stub.screensCalls[0].maxTokens], [1, true, budgets.SCREENS_BUDGET]);
  check('the page call was given the document and the screens, with room to think',
    [stub.calls[0].document.includes('Employees book pool cars'), stub.calls[0].document.includes('1. Bookings'), stub.calls[0].planned, stub.calls[0].maxTokens],
    [true, true, true, budgets.MOCKUP_BUDGET]);
  check('the mock-up is kept, from the document as it was read', [!!first.made, store.latestMockup(sketched.id).document_revision], [true, before]);
  check('keeping it is not a write to the document', store.getProject(sketched.id).document_revision, before);
  const stored = store.latestMockup(sketched.id).html;
  check('it is kept with its note and the file\'s own policy',
    [stored.startsWith('<!DOCTYPE html>\n<!--'), stored.includes('http-equiv="Content-Security-Policy"'), stored.includes('<main>Default</main>')], [true, true, true]);

  const shown = await viewRoute.GET(routeEvent(sketched, { 'sec-fetch-dest': 'iframe' }));
  check('its frame is answered with the page and the policy',
    [shown.status, await shown.text(), shown.headers.get('content-security-policy'), shown.headers.get('x-frame-options')],
    [200, stored, MOCKUP_POLICY, 'SAMEORIGIN']);
  check('so is a browser that does not say where it will be shown', (await viewRoute.GET(routeEvent(sketched))).status, 200);
  const ownTab = await viewRoute.GET(routeEvent(sketched, { 'sec-fetch-dest': 'document' }));
  check('but not a tab of its own, where only the header would hold the sandbox',
    [ownTab.status, (await ownTab.text()).includes(stored)], [403, false]);
  const downloaded = await downloadRoute.GET(routeEvent(sketched));
  check('the download is one file named for the application, with the same policy',
    [downloaded.headers.get('content-disposition'), downloaded.headers.get('content-security-policy'), await downloaded.text()],
    ['attachment; filename="mockup-project-mock-up.html"', MOCKUP_POLICY, stored]);
  check('a download with nothing made says so', await downloadRoute.GET(routeEvent(fixtureProject('mockup-none'))).catch((e) => e.status), 404);

  store.updateChapterState(sketched.id, 'overview', { contentMd: 'Employees book pool cars by the hour.' });
  check('the document changed since it was made', mockups.mockupView({ id: sketched.id }).made.stale, true);

  stub.calls = [];
  stub.replies = ['I could not make it this time.', page('Second')];
  await post(sketched.id);
  const retried = await made(sketched.id);
  check('a reply with no page is asked for once more, smaller', stub.calls.map((c) => c.brief), [false, true]);
  check('and the second is kept, made from the changed document',
    [store.latestMockup(sketched.id).html.includes('<main>Second</main>'), retried.made.stale], [true, false]);

  stub.calls = [];
  stub.replies = [fromOutside('Outside'), fromOutside('Outside again')];
  await post(sketched.id);
  const outside = await made(sketched.id);
  check('a page that loads from outside is asked for once more', stub.calls.map((c) => c.brief), [false, true]);
  check('and when the second does too, the fuller first is kept, said to be incomplete',
    [store.latestMockup(sketched.id).html.includes('<main>Outside</main>'), outside.made.incomplete], [true, true]);

  stub.calls = [];
  stub.screens = [new GatewayError('The gateway ran out of room before completing its response.'), '  \n'];
  stub.replies = [page('Undecided'), page('Undecided again')];
  await post(sketched.id);
  const undecided = await made(sketched.id);
  await post(sketched.id);
  await made(sketched.id);
  check('when deciding the screens runs out of room or decides nothing, the page call decides them',
    [stub.calls.map((c) => c.planned), stub.calls.some((c) => c.document.includes('already decided'))], [[false, false], false]);
  check('and the page is still made', [undecided.problem, store.latestMockup(sketched.id).html.includes('<main>Undecided again</main>')], [null, true]);

  const keptBefore = store.latestMockup(sketched.id).html;
  stub.calls = [];
  stub.replies = [new GatewayError('Gateway stream failed with 502')];
  await post(sketched.id);
  const failed = await made(sketched.id);
  check('a failed call is said in words, and not tried again here',
    [failed.problem?.startsWith('The mock-up could not be made.'), stub.calls.length], [true, 1]);
  check('and the last mock-up stays', store.latestMockup(sketched.id).html, keptBefore);

  stub.calls = [];
  stub.screens = [new GatewayError('Gateway stream failed with 502')];
  await post(sketched.id);
  const unreachable = await made(sketched.id);
  check('a failure deciding the screens is said in words, and no page is asked for',
    [unreachable.problem?.startsWith('The mock-up could not be made.'), stub.calls.length], [true, 0]);
  check('and the last mock-up stays, again', store.latestMockup(sketched.id).html, keptBefore);

  stub.replies = [new GatewayError('The gateway ran out of room before completing its response.'), new GatewayError('The gateway ran out of room before completing its response.')];
  await post(sketched.id);
  const tooBig = await made(sketched.id);
  check('running out of room twice says so, without the advice to ask for less',
    [/more than the assistant could write/.test(tooBig.problem), /one part at a time/.test(tooBig.problem)], [true, false]);

  stub.hold = deferred();
  stub.halfway = deferred();
  await post(sketched.id);
  await stub.halfway.promise;
  await (await mockupApi.DELETE({ url: new URL(`https://fixture.invalid/api/mockup?project=${sketched.id}`), locals: { user: admin } })).json();
  const stopped = await made(sketched.id);
  check('one being made can be stopped, and says so', [stopped.running, stopped.problem], [false, 'Stopped before it was finished.']);
  check('and keeps the last mock-up', store.latestMockup(sketched.id).html, keptBefore);
  stub.hold = null;
  gateway.streamChat = realStream;
  }

  {
  console.log('\n--- making an overview ---');
  const overviewApi = await import('../src/routes/api/overview/+server.ts');
  const overviews = await import('../src/lib/server/overviews.ts');
  const overviewPage = await import('../src/routes/projects/[id]/overview/+page.server.ts');
  const downloadRoute = await import('../src/routes/projects/[id]/overview/download/+server.ts');
  const { REPORT_POLICY } = await import('../src/lib/server/llm/overview.ts');
  const { GatewayError } = await import('../src/lib/server/llm/gateway.ts');
  const admin = store.getUser(1);
  const done = { type: 'done', servedBy: 'fixture', outputTokens: 10 };
  const reply = (pitch) => `<pitch>${pitch}</pitch>
<business-case>Fewer emails.</business-case>
<business-complexity level="low">One team.</business-complexity>
<technical-complexity level="medium">One integration.</technical-complexity>
<work>
Booking form | 10
Overview of the fleet | 10
</work>
<azure>
sql | s | bookings
mainframe | - | old records
</azure>
<assumptions>About fifty users.</assumptions>`;

  // A model that writes the overview in two parts and can be held between them.
  const stub = { replies: [], calls: [], hold: null, halfway: null };
  gateway.streamChat = async function* (req) {
    if (!req.system.includes('<business-case>')) { yield done; return; }
    stub.calls.push({ brief: req.system.includes('COULD NOT BE USED'), maxTokens: req.maxTokens, request: req.messages[0].content });
    const text = stub.replies.shift() ?? reply('Default pitch.');
    if (text instanceof Error) throw text;
    yield { type: 'thinking', text: 'Weighing it…' };
    const half = Math.floor(text.length / 2);
    yield { type: 'text', text: text.slice(0, half) };
    if (stub.hold) {
      stub.halfway?.resolve();
      await new Promise((resolve, reject) => {
        stub.hold.promise.then(resolve);
        req.signal?.addEventListener('abort', () => reject(req.signal.reason), { once: true });
      });
    }
    yield { type: 'text', text: text.slice(half) };
    yield done;
  };
  const made = async (id) => {
    for (let i = 0; i < 3000 && overviews.isMakingOverview(id); i++) await new Promise((r) => setTimeout(r, 10));
    return overviews.overviewView({ id });
  };
  const post = (projectId) => overviewApi.POST(event({ projectId })).catch((thrown) => thrown);
  const routeEvent = (project) => ({ params: { id: String(project.id) }, locals: { user: admin } });

  const summed = fixtureProject('overview-project');
  stub.calls = [];
  check('nothing written is refused before any call', [(await post(summed.id)).status, stub.calls.length], [422, 0]);
  check('the page loads with nothing made and nothing running',
    (await overviewPage.load({ params: { id: String(summed.id) }, locals: { user: admin } })).view,
    { running: false, phase: null, written: 0, retrying: false, problem: null, made: null });
  check('a download with nothing made says so', await downloadRoute.GET(routeEvent(summed)).catch((e) => e.status), 404);

  store.updateChapterState(summed.id, 'overview', { contentMd: 'Employees book pool cars by the day.' });
  const before = store.getProject(summed.id).document_revision;
  stub.hold = deferred();
  stub.halfway = deferred();
  const started = await post(summed.id);
  check('an overview is started and the request returns at once', [started.status, (await started.json()).running], [202, true]);
  await stub.halfway.promise;
  const midway = overviews.overviewView({ id: summed.id });
  check('its progress is what has been written so far', [midway.phase, midway.written > 0], ['writing', true]);
  check('asked again meanwhile, it is followed rather than doubled', [(await post(summed.id)).status, stub.calls.length], [202, 1]);
  stub.hold.resolve();
  stub.hold = null;
  const first = await made(summed.id);
  check('the call was given the document and what the triage said, with room to think',
    [stub.calls[0].request.includes('Employees book pool cars'), /This application is .*personal data/.test(stub.calls[0].request), stub.calls[0].maxTokens],
    [true, true, budgets.OVERVIEW_BUDGET]);
  check('the overview is kept, from the document as it was read', [first.made?.report.pitch[0].text, store.latestOverview(summed.id).document_revision], ['Default pitch.', before]);
  check('keeping it is not a write to the document', store.getProject(summed.id).document_revision, before);
  check('every figure is calculated: twenty days of building, by hand',
    [first.made.report.byHand.rows[0].days, first.made.report.byHand.days, first.made.report.byHand.cost], [20, 35.5, 35.5 * 600]);
  check('the reference architecture is counted, and what is not in it is named, not priced',
    [first.made.report.running.services.some((s) => s.name.startsWith('Secrets')), first.made.report.unpriced], [true, ['mainframe']]);
  check('it is not out of date', first.made.stale, false);

  const downloaded = await downloadRoute.GET(routeEvent(summed));
  const file = await downloaded.text();
  check('the download is one file named for the application, with a policy that loads nothing',
    [downloaded.headers.get('content-disposition'), downloaded.headers.get('content-security-policy').startsWith(REPORT_POLICY), file.startsWith('<!DOCTYPE html>'), /<script/i.test(file)],
    ['attachment; filename="overview-project-overview.html"', true, true, false]);
  check('and it carries the pitch, and says nothing of being out of date', [file.includes('Default pitch.'), /has changed since/.test(file)], [true, false]);

  store.updateChapterState(summed.id, 'overview', { contentMd: 'Employees book pool cars by the hour.' });
  check('the document changed since it was made, and the page says so',
    (await overviewPage.load({ params: { id: String(summed.id) }, locals: { user: admin } })).view.made.stale, true);
  check('and so does the file saved now', /has changed since/.test(await (await downloadRoute.GET(routeEvent(summed))).text()), true);

  stub.calls = [];
  stub.replies = ['I could not write it this time.', reply('Second pitch.')];
  await post(summed.id);
  const refreshed = await made(summed.id);
  check('a reply that is not an overview is asked for once more, with more room',
    stub.calls.map((c) => [c.brief, c.maxTokens]), [[false, budgets.OVERVIEW_BUDGET], [true, budgets.OVERVIEW_RETRY_BUDGET]]);
  check('and refreshing replaces it, made from the changed document',
    [refreshed.made.report.pitch[0].text, refreshed.made.stale], ['Second pitch.', false]);

  stub.calls = [];
  stub.replies = [new GatewayError('The gateway ran out of room before completing its response.'), reply('Third pitch.')];
  await post(summed.id);
  check('running out of room gets the second attempt too', [stub.calls.length, (await made(summed.id)).made.report.pitch[0].text], [2, 'Third pitch.']);

  stub.calls = [];
  stub.replies = [new GatewayError('Gateway stream failed with 502')];
  await post(summed.id);
  const failed = await made(summed.id);
  check('a failed call is said in words, and not tried again here',
    [failed.problem?.startsWith('The overview could not be made.'), stub.calls.length], [true, 1]);
  check('and the last overview stays', failed.made.report.pitch[0].text, 'Third pitch.');

  stub.replies = ['Nothing.', 'Nothing again.'];
  await post(summed.id);
  check('two replies that are not overviews say so, and the last stays',
    [(await made(summed.id)).problem, store.latestOverview(summed.id).content.pitch], ['The assistant did not write an overview this time. Try again in a minute.', 'Third pitch.']);

  stub.hold = deferred();
  stub.halfway = deferred();
  await post(summed.id);
  await stub.halfway.promise;
  await (await overviewApi.DELETE({ url: new URL(`https://fixture.invalid/api/overview?project=${summed.id}`), locals: { user: admin } })).json();
  const stopped = await made(summed.id);
  check('one being made can be stopped, and says so', [stopped.running, stopped.problem], [false, 'Stopped before it was finished.']);
  check('and keeps the last overview', store.latestOverview(summed.id).content.pitch, 'Third pitch.');
  stub.hold = null;
  gateway.streamChat = realStream;
  }
} finally {
  globalThis.fetch = realFetch;
  gateway.streamChat = realStream;
  gateway.callWithTools = realTools;
  database.close();
  rmSync(root, { recursive: true, force: true });
}
console.log(`\n${passed} boundary checks passed`);
