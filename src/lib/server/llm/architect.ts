import { gateway } from './gateway';
import { ChapterStreamParser } from './blocks';
import {
	buildModel,
	toElement,
	toRelation,
	type ArchitectureModel,
	type Element,
	type Relation
} from './architecture';
import type { Chapter, Requirement } from '../db/types';

/**
 * Deriving the layered model from the document.
 *
 * A separate pass rather than something the interview produces, for the same
 * reason verification is: the interview prompt is already at its budget, and
 * asking during a conversation would put architecture vocabulary in front of a
 * user who was promised none.
 *
 * One call. The input is deliberately small — chapter titles, the capabilities,
 * and requirement statements — because the model needs the *shape* of the
 * application, not its prose, and a small request survives any backend.
 */

const ELEMENT_FORMAT = `Reply with nothing but these tags, one per line.

<element type="actor" name="Employee" chapter="users-and-roles" />
<element type="process" name="Booking a car" chapter="booking-a-car" />

type is one of:
  actor          a person or group who uses or runs it        (business layer)
  process        something the business does, end to end      (business layer)
  service        a capability the application offers          (application layer)
  data           a kind of information it holds               (application layer)
  system         another system it exchanges data with        (technology layer)
  infrastructure something it runs on or depends on           (technology layer)

Rules:
- Name things as the document names them. Do not introduce vocabulary the user
  has never seen.
- Use "chapter" to give the key of the chapter the element comes from, where there
  is one.
- Between 6 and 20 elements. Leave out anything the document does not support —
  a diagram is worthless if the reader cannot trust it.
- Every capability listed as a sub-chapter should appear. Those are the point of
  the picture.`;

const RELATION_FORMAT = `Reply with nothing but these tags, one per line.

<relation from="Employee" to="Booking a car" kind="assigned" />

kind is one of:
  assigned  an actor carries out a process
  serves    the source enables or supports the target
  accesses  the source reads or writes the target
  flow      information passes from source to target

Rules:
- Use the exact names given. Never invent an identifier, and never name anything
  that is not in the list.
- Connect everything you can justify from the document, and nothing you cannot.
  A wrong line is worse than a missing one: the reader has no way to tell.
- Give each element at least one connection if the document supports it. An
  unconnected box tells the reader nothing.`;

export async function deriveArchitecture(args: {
	project: { name: string; description: string };
	chapters: Chapter[];
	requirements: Requirement[];
	signal?: AbortSignal;
}): Promise<ArchitectureModel> {
	const { project, chapters, requirements } = args;

	const inScope = chapters.filter((c) => c.applicable !== 0);
	const capabilities = inScope
		.filter((c) => c.parent_key)
		.map((c) => `- ${c.key}: ${c.title}`)
		.join('\n');

	const structure = inScope
		.filter((c) => !c.parent_key)
		.map((chapter) => {
			const own = requirements.filter((r) => r.chapter_key === chapter.key && r.scope !== 'out');
			const children = inScope.filter((c) => c.parent_key === chapter.key);
			const childRules = children.flatMap((child) =>
				requirements
					.filter((r) => r.chapter_key === child.key && r.scope !== 'out')
					.map((r) => `    ${r.statement}`)
			);

			return [
				`${chapter.title} (${chapter.key})`,
				...children.map((c) => `  - ${c.title} (${c.key})`),
				...own.map((r) => `  ${r.statement}`),
				...childRules
			].join('\n');
		})
		.join('\n\n');

	const document = `Application: ${project.name}
${project.description}

${capabilities ? `Its capabilities, each its own sub-chapter:\n${capabilities}\n` : ''}
The document, chapter by chapter, with what each says must be true:

${structure}`;

	try {
		// Two calls rather than one. Naming the parts and then connecting them are
		// separate jobs, and asking for both at once spent the entire output budget
		// on reasoning and produced nothing at all. Each half is small, and the
		// second is nearly mechanical because the list of names is given to it.
		const elements = await collect(
			`You are listing the parts of an application described in a design document,
as layers in the manner of ArchiMate. You are describing what the document
already says — you are not designing anything, and you must not add parts it
does not mention.

${ELEMENT_FORMAT}`,
			document,
			(parser) =>
				parser
					.blocksOf('element')
					.map((block) => toElement(block.attrs, block.body))
					.filter((element): element is Element => element !== null),
			args.signal
		);

		if (elements.length === 0) return { elements: [], relations: [] };

		const named = elements.map((element) => `- ${element.name} (${element.type})`).join('\n');

		const relations = await collect(
			`You are connecting up the parts of an application that have already been
identified, using only what its design document supports.

${RELATION_FORMAT}`,
			`${document}\n\nThe parts, which are the only things you may name:\n${named}`,
			(parser) =>
				parser
					.blocksOf('relation')
					.map((block) => toRelation(block.attrs))
					.filter((relation): relation is Relation => relation !== null),
			args.signal
		);

		return buildModel(elements, relations);
	} catch (error) {
		console.warn('[architect] could not derive the model:', error);
		return { elements: [], relations: [] };
	}
}

/** One streamed call, parsed. Reports an empty result rather than hiding it. */
async function collect<T>(
	system: string,
	prompt: string,
	extract: (parser: ChapterStreamParser) => T[],
	signal?: AbortSignal
): Promise<T[]> {
	let text = '';
	for await (const event of gateway.streamChat({
		system,
		messages: [{ role: 'user', content: prompt }],
		// Enumerating a whole document makes the served model reason at length, and
		// thinking tokens come out of this same budget. At 4000 both halves spent
		// the entire allowance deliberating and returned zero characters of text —
		// not truncated output, no output. This ceiling is the working room the
		// reasoning needs, not the size of the answer, which is a few hundred bytes.
		maxTokens: 12000,
		signal
	})) {
		if (event.type === 'text') text += event.text;
	}

	const parser = new ChapterStreamParser();
	parser.push(text);
	parser.end();

	const found = extract(parser);
	if (found.length === 0) {
		// Almost always the reasoning budget: the model deliberates, hits the
		// ceiling, and emits nothing. Worth saying out loud rather than returning
		// a silently empty diagram.
		console.warn(`[architect] nothing usable in ${text.length} characters of reply`);
	}
	return found;
}
