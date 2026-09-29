/**
 * Example organisation standards.
 *
 * The idea: security, data classification, licensing and telemetry usually have
 * a company-wide answer. Interviewing every requester from scratch wastes their
 * time and produces twelve different wordings of the same rule. Standards are
 * copied into a new project as requirements the assistant treats as settled,
 * and it then asks only where the project needs to *deviate*.
 *
 * IMPORTANT: these are seeded **inactive**. They are plausible examples, not
 * Škoda policy — nobody has approved them. Injecting invented rules into every
 * application's specification, where they would read as official, is exactly the
 * sort of thing that gets a specification thrown out by the people who own the
 * real standards.
 *
 * An administrator reviews them, edits them to match what the organisation
 * actually requires, and switches on the ones that are real.
 */
export interface SeedStandard {
	chapterKey: string;
	statement: string;
	scenarios: Array<{ when: string; then: string }>;
	appliesWhen: string[];
}

export const DEFAULT_STANDARDS: SeedStandard[] = [
	{
		chapterKey: 'authentication',
		statement:
			'People sign in with their existing company account. The application keeps no passwords of its own.',
		scenarios: [
			{
				when: 'an employee opens the application',
				then: 'they sign in with the account they already use for work, and no separate password is created'
			}
		],
		appliesWhen: ['always']
	},
	{
		chapterKey: 'data-classification',
		statement:
			'Information about identifiable people is kept only as long as it is needed, and deleted afterwards.',
		scenarios: [
			{
				when: 'a record about a person is no longer needed for the purpose it was collected for',
				then: 'it is deleted rather than kept indefinitely'
			}
		],
		appliesWhen: ['personal_data']
	},
	{
		chapterKey: 'security',
		statement:
			'Every change to a stored record is recorded with who made it and when.',
		scenarios: [
			{
				when: 'someone creates, changes, or deletes a record',
				then: 'the application keeps a note of who did it and at what time'
			}
		],
		appliesWhen: ['critical', 'personal_data']
	},
	{
		chapterKey: 'telemetry',
		statement:
			'The application reports whether it is working to the team responsible for running it.',
		scenarios: [
			{
				when: 'the application stops working or starts failing',
				then: 'the responsible team is told without a person having to notice and report it'
			}
		],
		appliesWhen: ['beyond_team']
	},
	{
		chapterKey: 'licenses',
		statement:
			'Third-party components are used only where their licence permits use inside the company.',
		scenarios: [
			{
				when: 'a component made by someone else is included',
				then: 'its licence is recorded and permits the use the application makes of it'
			}
		],
		appliesWhen: ['always']
	}
];
