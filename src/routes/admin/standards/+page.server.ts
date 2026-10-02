import { error, fail } from '@sveltejs/kit';
import { listStandards, updateStandard } from '$lib/server/db';
import { CONDITIONS, readConditions } from '$lib/server/llm/profile';
import { readScenarioLines, scenarioLines } from '$lib/server/llm/requirements';
import type { Actions, PageServerLoad } from './$types';

/** One shape for every refusal, so the page can tell which card a refusal belongs to. */
type Refusal = {
	message: string;
	id?: number;
	values?: { statement: string; appliesWhen: string; scenarios: string; active: boolean };
};

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user?.is_admin) throw error(403, 'Administrators only');
	return {
		standards: listStandards().map((standard) => ({ ...standard, examples: scenarioLines(standard.scenarios) })),
		conditions: CONDITIONS.join(', ')
	};
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		if (!locals.user?.is_admin) throw error(403, 'Administrators only');

		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!id) return fail<Refusal>(400, { message: 'Which standard?' });
		// A standard deleted or renumbered since the page loaded is an answer,
		// not a crash.
		if (!listStandards().some((standard) => standard.id === id)) {
			return fail<Refusal>(400, { message: 'That standard is no longer there. Reload the page.' });
		}

		const statement = String(form.get('statement') ?? '').trim();
		const appliesWhen = String(form.get('appliesWhen') ?? '');
		const scenarios = String(form.get('scenarios') ?? '');
		// Sent back with a refusal, so the form shows what was typed rather than
		// what is stored — reloaded from storage, the rest of an edit was lost
		// over one line that could not be read.
		const refuse = (message: string) =>
			fail<Refusal>(400, { message, id, values: { statement, appliesWhen, scenarios, active: form.get('active') === 'on' } });

		if (!statement) return refuse('A standard needs wording.');

		const read = readConditions(appliesWhen);
		if ('unknown' in read) {
			return refuse(`“${read.unknown.join('”, “')}” is not a condition. Use any of: ${CONDITIONS.join(', ')}.`);
		}

		// The examples are edited with the wording. Fixed, they went on describing
		// the old rule, and every application inherited a requirement whose own
		// examples contradicted it.
		const examples = readScenarioLines(scenarios);
		if ('unreadable' in examples) {
			return refuse(`Write each example as “If …, then …”. This one could not be read: “${examples.unreadable[0]}”.`);
		}
		if (examples.scenarios.length === 0) {
			return refuse('A standard needs at least one example, or nobody can check it was met.');
		}

		updateStandard(id, {
			statement,
			active: form.get('active') === 'on',
			appliesWhen: read.conditions,
			scenarios: examples.scenarios
		});

		return { saved: true };
	}
};
