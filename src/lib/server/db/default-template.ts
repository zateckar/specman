/**
 * The default document template.
 *
 * `purpose` and `questions` are written for the *agent*, but the questions are
 * phrased the way they should reach a non-technical user: no jargon, one
 * decision at a time, and always about their business, never about technology.
 *
 * Editable through the admin UI; this is only the seed.
 */
export interface SeedChapter {
	key: string;
	title: string;
	/** One sentence shown to the user: what this chapter is for. */
	goal: string;
	purpose: string;
	questions: string[];
	criteria: string[];
	is_dynamic?: boolean;
	/**
	 * When this chapter is worth asking about. Any condition holding is enough;
	 * omitted means always. See `llm/profile.ts`.
	 */
	appliesWhen?: string[];
}

export const DEFAULT_TEMPLATE = {
	name: 'Standard application design',
	description:
		'Default Škoda application design document: fixed governance chapters plus ' +
		'dynamic chapters describing what the application actually does.'
};

export const DEFAULT_CHAPTERS: SeedChapter[] = [
	{
		key: 'overview',
		title: 'Overview',
		goal: 'Say what the application is for, and how you will know it worked.',
		purpose:
			'Establish what the application is, who asked for it, and what problem it solves. ' +
			'This chapter anchors every other chapter — write it first and refer back to it.',
		questions: [
			'In one or two sentences, what should this application do?',
			'What do people do today instead, and what goes wrong with that?',
			'How will you know, six months after launch, whether it worked?',
			'Roughly how many people will use it?'
		],
		criteria: [
			'The purpose is stated in plain language without naming any technology',
			'The problem being solved is described',
			'At least one measure of success is recorded',
			'Expected scale is recorded, even approximately'
		]
	},
	{
		key: 'users-and-roles',
		title: 'Users and roles',
		goal: 'Name everyone who uses it, and what each of them is allowed to do.',
		purpose:
			'Identify every group of people who interact with the application and what each ' +
			'group is allowed to do. This chapter feeds Authorization directly.',
		questions: [
			'Who will use this application day to day?',
			'Is there anyone who needs to see more, or do more, than a normal user?',
			'Is there anyone who should only be able to look, never change anything?',
			'Will anyone outside the company need access?'
		],
		criteria: [
			'Every distinct user group is named',
			'Each group has a described set of things it may do',
			'Whether external (non-employee) access is required is settled'
		]
	},
	{
		key: 'functionality',
		title: 'What the application does',
		goal: 'Describe what the application actually does, from start to finish.',
		purpose:
			'Describe the actual features, as user-facing capabilities rather than screens or ' +
			'components. Expand this into sub-chapters when a feature is large enough to warrant ' +
			'its own discussion. This is the chapter a developer reads to know what to build.',
		questions: [
			'Walk me through what a normal user does, from opening the application to finishing their task.',
			'What is the single most important thing it must get right?',
			'What should it deliberately NOT do?',
			'Is there anything that has to happen automatically, without a person triggering it?'
		],
		criteria: [
			'The main user journey is described end to end',
			'Each capability is stated as something a user can accomplish',
			'Explicit non-goals are recorded',
			'Any scheduled or automatic behaviour is described'
		],
		is_dynamic: true
	},
	{
		key: 'data',
		title: 'Information held',
		goal: 'List the information the application keeps, and where it comes from.',
		purpose:
			'Catalogue what information the application stores. Establish the real-world things ' +
			'it tracks and the facts recorded about each. Feeds Data classification.',
		questions: [
			'What things does the application need to keep track of?',
			'For each of those, what details matter?',
			'Where does that information come from — typed in, or taken from another system?',
			'Does anything need to be kept for a fixed period, or deleted after a while?'
		],
		criteria: [
			'Every kind of record the application stores is listed',
			'The origin of each is identified',
			'Retention expectations are recorded where they exist'
		]
	},
	{
		key: 'data-classification',
		appliesWhen: ['personal_data', 'critical'],
		title: 'Data classification',
		goal: 'Decide how sensitive each kind of information is, and what that means for handling it.',
		purpose:
			'Assign a sensitivity level to each kind of information from the Information held ' +
			'chapter, and state the handling obligations that follow. Do not invent categories the ' +
			'user has not confirmed.',
		questions: [
			'Does the application hold anything about identifiable people — names, contact details, photographs?',
			'Does it hold anything that would cause harm if it leaked outside the company?',
			'Is any of it commercially confidential, or covered by a contract with another company?',
			'Does anything need to stay inside a particular country or region?'
		],
		criteria: [
			'Every kind of information has a sensitivity level',
			'Whether personal data is involved is settled explicitly',
			'Any residency or regulatory constraint is recorded',
			'Handling obligations follow from the levels assigned'
		]
	},
	{
		key: 'authentication',
		title: 'Authentication',
		goal: 'Settle how people prove who they are when they sign in.',
		purpose:
			'Establish how a user proves who they are. Prefer corporate single sign-on unless the ' +
			'user has a concrete reason otherwise.',
		questions: [
			'Should people sign in with their normal company account?',
			'Does anyone need access who does not have a company account?',
			'Should the application remember people between visits, or ask every time?',
			'Do any other systems or scripts need to connect to it without a person involved?'
		],
		criteria: [
			'The sign-in method for each user group is settled',
			'Whether non-employee access is needed is settled',
			'Machine-to-machine access is either specified or explicitly ruled out'
		]
	},
	{
		key: 'authorization',
		appliesWhen: ['beyond_team', 'critical', 'personal_data'],
		title: 'Authorization',
		goal: 'Settle who may do what, and who grants or removes access.',
		purpose:
			'Turn the roles from Users and roles into concrete permissions. Every capability in the ' +
			'functionality chapter should be answerable: who may do this?',
		questions: [
			'Should everyone see all the information, or only their own?',
			'Who is allowed to change or delete things other people created?',
			'Does anything need approval from a second person before it takes effect?',
			'Who decides who gets access, and how do they grant it?'
		],
		criteria: [
			'Each role maps to a set of permitted actions',
			'Rules for seeing other people’s data are explicit',
			'Any approval step is described',
			'The process for granting and revoking access is recorded'
		]
	},
	{
		key: 'security',
		title: 'Security',
		goal: 'Name what could go wrong, and what is done to prevent it.',
		purpose:
			'Record the threats that matter for this application and the controls chosen against ' +
			'them. Keep it proportionate to the data classification — do not over-engineer.',
		questions: [
			'What would be the worst thing that could happen if this application were misused?',
			'Is there anything in it that would be attractive to an attacker?',
			'Does anything need to be recorded for audit — who did what, and when?',
			'Are there security rules or standards your department already has to follow?'
		],
		criteria: [
			'The main risks are named',
			'A control is recorded for each named risk',
			'Audit requirements are settled',
			'Applicable internal standards are referenced'
		]
	},
	{
		key: 'integration',
		title: 'Integration',
		goal: 'Identify the other systems this exchanges information with.',
		purpose:
			'Identify every other system this application exchanges data with, in each direction, ' +
			'and what happens when one of them is unavailable.',
		questions: [
			'Does it need information from any system that already exists?',
			'Does anything else need to receive information from it?',
			'Does information need to move immediately, or is once a day enough?',
			'What should happen if one of those systems is unavailable?'
		],
		criteria: [
			'Every connected system is named, with the direction of flow',
			'Timing expectations are recorded for each',
			'Behaviour on failure of each dependency is described'
		]
	},
	{
		key: 'licenses',
		title: 'Licences and third-party components',
		goal: 'Record what this depends on that someone else owns or charges for.',
		purpose:
			'Record licensing obligations: purchased software, third-party services, open-source ' +
			'components, and any content whose rights need clearing.',
		questions: [
			'Does this rely on any software or service the company pays for?',
			'Is there a limit on how many people may use those?',
			'Does it use any maps, fonts, images, or data provided by someone else?',
			'Will any of this be shared outside the company, or published?'
		],
		criteria: [
			'Every paid dependency is listed with its licensing model',
			'Seat or usage limits are recorded',
			'Third-party content is identified with its rights position',
			'Distribution outside the company is settled'
		]
	},
	{
		key: 'telemetry',
		appliesWhen: ['beyond_team', 'critical'],
		title: 'Telemetry and monitoring',
		goal: 'Decide how you will know it is working, and who is told when it is not.',
		purpose:
			'Establish what is measured once the application is running: health, usage, and errors. ' +
			'Cross-check against Data classification — telemetry frequently captures personal data.',
		questions: [
			'How will you know if the application stops working?',
			'Who should be told when something breaks, and how quickly?',
			'What would you want to measure about how it is being used?',
			'Should individual actions be traceable back to the person who performed them?'
		],
		criteria: [
			'Failure detection is described',
			'An escalation path with expected response time is recorded',
			'Usage measures are listed',
			'Whether telemetry identifies individuals is settled, consistent with data classification'
		]
	},
	{
		key: 'operations',
		title: 'Running the application',
		goal: 'Settle who runs it, when it must be available, and who pays.',
		purpose:
			'Cover the life of the application after launch: where it runs, who supports it, and ' +
			'what happens when it fails or needs to change.',
		questions: [
			'When does it need to be available — office hours, or all the time?',
			'Who will look after it once it is live?',
			'If it lost a day of information, how bad would that be?',
			'Who pays for it, and is there a budget limit?'
		],
		criteria: [
			'Availability expectations are recorded',
			'An owning team or person is named',
			'Acceptable data loss and downtime are stated',
			'Budget ownership is recorded'
		]
	}
];
