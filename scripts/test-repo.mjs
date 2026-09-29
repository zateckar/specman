/**
 * The branch assertion, against a real repository.
 *
 * Separate from `test-agent.mjs` on purpose. That file loads import-free modules
 * and nothing else, which is what lets it run under plain Node with no runner —
 * and it is exactly why this went untested for as long as it did. `commitAll`
 * reaches `simple-git` and a working tree, so it needs a repository to run
 * against, and putting one in there would quietly end the "no imports" rule that
 * makes the other file work.
 *
 * What this guards is the load-bearing half of `keep-changes-on-the-proposal-branch`.
 * The per-repository lock orders writes within one process; this assertion is
 * what makes a write to the wrong branch *detectable*, and it is the only part
 * that still holds if Specman is ever run behind more than one process.
 *
 *   npm test
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import {
	MAIN_BRANCH,
	WrongBranch,
	checkoutBranch,
	commitAll,
	currentBranch,
	ensureRepo
} from '../src/lib/server/git/repo.ts';

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

const root = mkdtempSync(join(tmpdir(), 'specman-repo-'));

try {
	console.log('--- a commit names the branch it expects ---');

	await ensureRepo(root, 'Car booking');
	check('a new repository starts on main', await currentBranch(root), MAIN_BRANCH);

	const git = simpleGit(root);
	const commitCount = async () => (await git.log()).total;

	const startedWith = await commitCount();

	// The ordinary case still works.
	await checkoutBranch(root, 'spec/0001');
	writeFileSync(join(root, 'docs', '010-overview.md'), '# Overview\n\nA car booking app.\n');
	const hash = await commitAll(root, 'Update Overview', 'spec/0001');
	check('a commit on the expected branch is made', typeof hash === 'string' && hash.length > 0, true);
	check('and it is one commit', await commitCount(), startedWith + 1);

	// Nothing to do is still nothing to do.
	check('an unchanged tree produces no commit', await commitAll(root, 'Again', 'spec/0001'), null);

	// --- The case this exists for. An approval checks out main; a turn that
	//     believes it is on its proposal branch must not stage its chapters there.
	await checkoutBranch(root, MAIN_BRANCH);
	// Checking out main takes the overview file away with it, and git does not
	// keep an empty directory — so `docs/` has to be put back before writing.
	mkdirSync(join(root, 'docs'), { recursive: true });
	writeFileSync(join(root, 'docs', '020-people.md'), '# People\n\nWritten by a turn that lost its branch.\n');

	const before = await commitCount();
	let raised = null;
	try {
		await commitAll(root, 'Update People', 'spec/0001');
	} catch (cause) {
		raised = cause;
	}

	check('a commit meant for the proposal branch refuses to run on main', raised instanceof WrongBranch, true);
	check('it says which branch it wanted', raised?.expected, 'spec/0001');
	check('and which one it found', raised?.actual, MAIN_BRANCH);
	check('nothing is committed', await commitCount(), before);

	// The file is still sitting there uncommitted, which is the point: the work is
	// not lost, it simply has not been recorded on the wrong branch.
	check('the working tree is left alone', (await git.status()).not_added.length > 0, true);

	// --- "Nothing changed" and "this is not the branch you think" must not look
	//     the same. Checking the tree first would report null here and the caller
	//     would treat a write that went nowhere as a success.
	await git.reset(['--hard']);
	await git.clean('f', ['-d']);

	let raisedOnClean = null;
	try {
		await commitAll(root, 'Nothing to do', 'spec/0001');
	} catch (cause) {
		raisedOnClean = cause;
	}
	check(
		'an unchanged tree on the wrong branch fails rather than reporting nothing to do',
		raisedOnClean instanceof WrongBranch,
		true
	);
} finally {
	rmSync(root, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
