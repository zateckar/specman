#!/usr/bin/env node
/**
 * The documentation check.
 *
 * Specman's own documentation lives in `openspec/` in OpenSpec format: `specs/`
 * is what the code does today, `changes/` is what someone proposes it should do
 * instead. This script is what stops that from drifting, and it runs inside
 * `npm test` so no change can be finished without it.
 *
 * It checks three things, in increasing order of usefulness:
 *
 *   1. Shape    — every capability has a purpose, sources and requirements, and
 *                 every requirement has at least one scenario. A requirement
 *                 with no scenario is an opinion: nobody can tell whether it
 *                 holds.
 *
 *   2. Coverage — every file under `src/` is claimed by exactly one capability's
 *                 `## Source` list, and every claimed path exists. This is the
 *                 part that makes documentation mandatory rather than merely
 *                 encouraged: adding a module, renaming one, or moving code
 *                 between areas all fail here until the specification is told.
 *
 *   3. Proposals — a change folder has a proposal, a task list, and a spec delta
 *                 using only ADDED / MODIFIED / REMOVED / RENAMED headers.
 *
 * Plain Node, no dependencies and no runner — the same arrangement as
 * `test-agent.mjs`, for the same reason.
 *
 * Usage:
 *   node scripts/check-docs.mjs            report and exit 1 on failure
 *   node scripts/check-docs.mjs --quiet    say nothing unless something is wrong
 *   node scripts/check-docs.mjs --hook     exit 2 on failure, for a blocking hook
 *   node scripts/check-docs.mjs --notify   name the governing spec for an edited
 *                                          file, read from hook JSON on stdin
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, posix, relative } from 'node:path';

const ROOT = process.cwd();
const OPENSPEC = join(ROOT, 'openspec');
const SPECS = join(OPENSPEC, 'specs');
const CHANGES = join(OPENSPEC, 'changes');

/** Files with no behaviour of their own. Deliberately hard to grow. */
const EXEMPT = new Set(['src/app.d.ts', 'src/app.html']);

/** Extensions that count as source for the coverage check. */
const SOURCE_EXTENSIONS = ['.ts', '.svelte', '.js', '.mjs'];

/** The only section headers a change delta may use. */
const DELTA_SECTIONS = new Set([
	'ADDED Requirements',
	'MODIFIED Requirements',
	'REMOVED Requirements',
	'RENAMED Requirements'
]);

const problems = [];

function fail(where, message) {
	problems.push({ where, message });
}

// ---------------------------------------------------------------- reading ---

function read(path) {
	return readFileSync(path, 'utf8').split(/\r?\n/);
}

function directories(path) {
	if (!existsSync(path)) return [];
	return readdirSync(path)
		.filter((name) => !name.startsWith('.'))
		.filter((name) => statSync(join(path, name)).isDirectory())
		.sort();
}

/** Every source file under a directory, as repo-relative posix paths. */
function sourceFiles(path, found = []) {
	for (const entry of readdirSync(path, { withFileTypes: true })) {
		if (entry.name.startsWith('.')) continue;
		const full = join(path, entry.name);
		if (entry.isDirectory()) {
			sourceFiles(full, found);
		} else if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
			found.push(relative(ROOT, full).split(/[\\/]/).join(posix.sep));
		}
	}
	return found;
}

/**
 * Pull the structure out of a Markdown file in one pass.
 *
 * Fenced code is passed through as body text rather than parsed, so an example
 * of a requirement inside a code block is not mistaken for one.
 */
function parse(lines) {
	const sections = [];
	const requirements = [];

	let section = null;
	let requirement = null;
	let scenario = null;
	let fenced = false;

	lines.forEach((raw, index) => {
		const line = raw.trimEnd();
		const number = index + 1;

		if (/^\s*```/.test(line)) {
			fenced = !fenced;
			return;
		}
		if (fenced) {
			if (scenario) scenario.body.push(line);
			else if (requirement) requirement.intro.push(line);
			else if (section) section.body.push(line);
			return;
		}

		const heading = /^(#{1,4})\s+(.*\S)\s*$/.exec(line);
		if (heading) {
			const depth = heading[1].length;
			const title = heading[2];

			if (depth <= 2) {
				section = { title: depth === 2 ? title : null, line: number, body: [] };
				if (depth === 2) sections.push(section);
				requirement = null;
				scenario = null;
				return;
			}

			const asRequirement = /^Requirement:\s*(.+)$/.exec(title);
			if (depth === 3 && asRequirement) {
				requirement = {
					name: asRequirement[1].trim(),
					section: section?.title ?? null,
					line: number,
					intro: [],
					scenarios: []
				};
				scenario = null;
				requirements.push(requirement);
				return;
			}

			const asScenario = /^Scenario:\s*(.+)$/.exec(title);
			if (depth === 4 && asScenario && requirement) {
				scenario = { name: asScenario[1].trim(), line: number, body: [] };
				requirement.scenarios.push(scenario);
				return;
			}

			// Any other heading ends the block it sits in.
			if (depth === 3) {
				requirement = null;
				scenario = null;
			}
			return;
		}

		if (scenario) scenario.body.push(line);
		else if (requirement) requirement.intro.push(line);
		else if (section) section.body.push(line);
	});

	return { sections, requirements };
}

function sectionNamed(parsed, title) {
	return parsed.sections.find((s) => s.title === title);
}

function hasText(section) {
	return !!section && section.body.some((line) => line.trim().length > 0);
}

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// ------------------------------------------------------------ requirements ---

/**
 * The rules every requirement obeys, wherever it is written.
 *
 * `needScenarios` is a predicate rather than a flag because a delta mixes them:
 * a removal names a requirement and says why, while anything stated in full
 * carries the scenarios it should have afterwards.
 */
function checkRequirements(where, requirements, needScenarios = () => true) {
	const seen = new Map();

	for (const requirement of requirements) {
		const at = `${where}:${requirement.line}`;

		if (seen.has(requirement.name)) {
			fail(at, `two requirements are called "${requirement.name}" — a name is how a delta refers to one`);
		}
		seen.set(requirement.name, requirement.line);

		const statement = requirement.intro.join(' ');
		if (!statement.trim()) {
			fail(at, `"${requirement.name}" states nothing before its first scenario`);
		} else if (!/\b(SHALL|MUST)\b/.test(statement)) {
			fail(at, `"${requirement.name}" does not say SHALL or MUST — say what must hold, not what happens`);
		}

		if (needScenarios(requirement) && requirement.scenarios.length === 0) {
			fail(at, `"${requirement.name}" has no scenario — a rule nobody can check is an opinion`);
		}

		for (const scenario of requirement.scenarios) {
			const body = scenario.body.join('\n');
			const missing = ['**WHEN**', '**THEN**'].filter((marker) => !body.includes(marker));
			if (missing.length > 0) {
				fail(
					`${where}:${scenario.line}`,
					`scenario "${scenario.name}" is missing ${missing.join(' and ')}`
				);
			}
		}
	}
}

// ------------------------------------------------------------ capabilities ---

function checkCapabilities() {
	const capabilities = new Map();

	if (!existsSync(SPECS)) {
		fail('openspec/specs', 'there are no capability specifications at all');
		return capabilities;
	}

	for (const name of directories(SPECS)) {
		const where = `openspec/specs/${name}/spec.md`;
		const path = join(SPECS, name, 'spec.md');

		if (!KEBAB.test(name)) {
			fail(`openspec/specs/${name}`, 'a capability directory is named in kebab-case');
		}
		if (!existsSync(path)) {
			fail(`openspec/specs/${name}`, 'has no spec.md');
			continue;
		}

		const parsed = parse(read(path));
		capabilities.set(name, { where, parsed, sources: [] });

		for (const required of ['Purpose', 'Source']) {
			if (!hasText(sectionNamed(parsed, required))) {
				fail(where, `no ## ${required} section, or it is empty`);
			}
		}

		// The requirements section holds headings rather than prose, so its
		// emptiness says nothing; what matters is that requirements exist.
		if (!sectionNamed(parsed, 'Requirements')) {
			fail(where, 'no ## Requirements section');
		}

		if (parsed.requirements.length === 0) {
			fail(where, 'declares no requirements — say what this capability guarantees');
		}

		checkRequirements(where, parsed.requirements);

		const source = sectionNamed(parsed, 'Source');
		for (const line of source?.body ?? []) {
			const entry = /^\s*[-*]\s+`([^`]+)`\s*$/.exec(line);
			if (entry) {
				capabilities.get(name).sources.push(entry[1].trim());
			} else if (/^\s*[-*]\s+/.test(line)) {
				fail(where, `"${line.trim()}" is not a path in backticks — ## Source is a list of files only`);
			}
		}
	}

	return capabilities;
}

// ---------------------------------------------------------------- coverage ---

function checkCoverage(capabilities) {
	const claimed = new Map();

	for (const [name, capability] of capabilities) {
		for (const path of capability.sources) {
			if (!existsSync(join(ROOT, path))) {
				fail(capability.where, `claims \`${path}\`, which does not exist — renamed or deleted?`);
				continue;
			}
			if (claimed.has(path)) {
				fail(
					capability.where,
					`\`${path}\` is already claimed by ${claimed.get(path)} — one file belongs to one capability`
				);
				continue;
			}
			claimed.set(path, name);
		}
	}

	const src = join(ROOT, 'src');
	if (!existsSync(src)) return;

	for (const path of sourceFiles(src).sort()) {
		if (EXEMPT.has(path) || claimed.has(path)) continue;
		fail(path, 'nothing documents this file — add it to a capability\'s ## Source list');
	}
}

// ----------------------------------------------------------------- changes ---

function checkChanges(capabilities) {
	if (!existsSync(CHANGES)) return;

	for (const id of directories(CHANGES)) {
		if (id === 'archive') continue;

		const folder = join(CHANGES, id);
		const where = `openspec/changes/${id}`;

		if (!KEBAB.test(id)) {
			fail(where, 'a change id is kebab-case and names the outcome, not the mechanism');
		}

		const proposal = join(folder, 'proposal.md');
		if (!existsSync(proposal)) {
			fail(where, 'has no proposal.md — copy openspec/templates/proposal.md');
		} else {
			const parsed = parse(read(proposal));
			for (const required of ['Why', 'What Changes']) {
				if (!hasText(sectionNamed(parsed, required))) {
					fail(`${where}/proposal.md`, `no ## ${required} section, or it is empty`);
				}
			}
		}

		const tasks = join(folder, 'tasks.md');
		if (!existsSync(tasks)) {
			fail(where, 'has no tasks.md — copy openspec/templates/tasks.md');
		} else if (!read(tasks).some((line) => /^\s*[-*]\s+\[[ xX]\]\s+\S/.test(line))) {
			fail(`${where}/tasks.md`, 'lists no tasks');
		}

		const deltas = join(folder, 'specs');
		const touched = directories(deltas);
		if (touched.length === 0) {
			fail(
				where,
				'changes no capability — if behaviour is unaffected this is a refactor and needs no proposal'
			);
			continue;
		}

		for (const capability of touched) {
			const path = join(deltas, capability, 'spec.md');
			const deltaWhere = `${where}/specs/${capability}/spec.md`;

			if (!existsSync(path)) {
				fail(`${where}/specs/${capability}`, 'has no spec.md');
				continue;
			}

			const parsed = parse(read(path));
			const headers = parsed.sections.map((section) => section.title);
			const unknown = headers.filter((title) => !DELTA_SECTIONS.has(title));

			for (const title of unknown) {
				fail(deltaWhere, `"## ${title}" is not a delta header — use ADDED / MODIFIED / REMOVED / RENAMED`);
			}
			if (headers.length === 0) {
				fail(deltaWhere, 'carries no delta section');
			}

			const isNew = headers.includes('ADDED Requirements');
			if (!capabilities.has(capability) && !isNew) {
				fail(
					deltaWhere,
					`no capability "${capability}" exists — add requirements under ## ADDED Requirements to create one`
				);
			}

			checkRequirements(
				deltaWhere,
				parsed.requirements,
				(requirement) => requirement.section !== 'REMOVED Requirements'
			);

			for (const requirement of parsed.requirements) {
				if (requirement.section === 'MODIFIED Requirements' && capabilities.has(capability)) {
					const existing = capabilities
						.get(capability)
						.parsed.requirements.map((r) => r.name);
					if (!existing.includes(requirement.name)) {
						fail(
							`${deltaWhere}:${requirement.line}`,
							`modifies "${requirement.name}", which is not in openspec/specs/${capability}/spec.md`
						);
					}
				}
			}
		}
	}
}

// ------------------------------------------------------------ entry points ---

function checkEntryPoints() {
	for (const file of ['openspec/project.md', 'openspec/AGENTS.md']) {
		if (!existsSync(join(ROOT, file))) fail(file, 'is missing');
	}

	const readme = join(ROOT, 'README.md');
	if (existsSync(readme) && !readFileSync(readme, 'utf8').includes('openspec/')) {
		fail('README.md', 'never mentions openspec/ — the specifications need a way in');
	}
}

/**
 * The JSON a Claude Code hook sends on stdin, or null when there is none.
 * Never read from a terminal, which would block waiting for input.
 */
function hookPayload() {
	if (process.stdin.isTTY) return null;
	try {
		return JSON.parse(readFileSync(0, 'utf8'));
	} catch {
		return null;
	}
}

/**
 * PostToolUse mode: say which capability governs the file that was just edited.
 * Advisory only — the blocking check is the full run.
 */
function notify() {
	const payload = hookPayload();
	const raw = payload?.tool_input?.file_path;
	if (typeof raw !== 'string') return 0;

	const path = relative(ROOT, raw).split(/[\\/]/).join(posix.sep);
	if (!path.startsWith('src/') || EXEMPT.has(path)) return 0;

	const capabilities = checkCapabilities();
	for (const [name, capability] of capabilities) {
		if (capability.sources.includes(path)) {
			console.log(
				`${path} is specified by openspec/specs/${name}/spec.md — update it if the behaviour changed.`
			);
			return 0;
		}
	}

	console.log(
		`${path} is not claimed by any capability. Add it to a ## Source list in openspec/specs/, or npm test will fail.`
	);
	return 0;
}

function main() {
	const args = process.argv.slice(2);
	if (args.includes('--notify')) return notify();

	const quiet = args.includes('--quiet');

	// A blocking Stop hook that has already fired once must not fire again, or a
	// specification that cannot be made to pass becomes a loop rather than a
	// message. Claude Code says so in the payload; after that, report and let go.
	const hook = args.includes('--hook') && hookPayload()?.stop_hook_active !== true;

	checkEntryPoints();
	const capabilities = checkCapabilities();
	checkCoverage(capabilities);
	checkChanges(capabilities);

	if (problems.length === 0) {
		const requirements = [...capabilities.values()].reduce(
			(sum, capability) => sum + capability.parsed.requirements.length,
			0
		);
		const scenarios = [...capabilities.values()].reduce(
			(sum, capability) =>
				sum + capability.parsed.requirements.reduce((n, r) => n + r.scenarios.length, 0),
			0
		);
		if (!quiet) {
			console.log(
				`docs ok — ${capabilities.size} capabilities, ${requirements} requirements, ${scenarios} scenarios`
			);
		}
		return 0;
	}

	const stream = hook ? console.error : console.log;
	const count = `${problems.length} problem${problems.length === 1 ? '' : 's'}`;

	stream('');
	stream(`The documentation does not match the code — ${count}:`);
	stream('');
	for (const problem of problems) {
		stream(`  ${problem.where}`);
		stream(`      ${problem.message}`);
	}
	stream('');
	stream('See openspec/AGENTS.md. No change is finished until the specification agrees with it.');

	return hook ? 2 : 1;
}

process.exit(main());
