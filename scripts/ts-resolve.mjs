/**
 * Resolve the import style the application source is written in.
 *
 * SvelteKit's build resolves `../markdown` to `../markdown.ts`. Plain Node does
 * not: ESM requires the extension. That single difference is why only the
 * import-free modules under `src/lib/server/llm/` could be tested directly, and
 * why the branch assertion in `git/repo.ts` went untested for as long as it did.
 *
 * Rewriting every import in the application to carry `.ts` would make the source
 * worse to read in order to suit the test runner. Teaching the test runner the
 * project's resolution instead costs twenty lines and changes nothing anyone has
 * to look at while working.
 *
 * Only relative specifiers are touched. `$lib/...` aliases are deliberately not
 * handled: a module reaching for one is a module bound to SvelteKit, and the
 * honest answer there is that it belongs behind a seam rather than in a test.
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/test-repo.mjs
 */
import { registerHooks } from 'node:module';

const HAS_EXTENSION = /\.[a-z0-9]+$/i;

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.startsWith('.') && !HAS_EXTENSION.test(specifier)) {
			for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
				try {
					return nextResolve(candidate, context);
				} catch {
					// Try the next shape, then fall through to Node's own answer, so the
					// error a developer sees is about their import rather than about this.
				}
			}
		}

		return nextResolve(specifier, context);
	}
});
