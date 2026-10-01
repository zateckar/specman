/**
 * The folder name an application's repository lives under.
 *
 * Windows reserves a handful of device names in every directory, with or without
 * an extension, so an application called "Con" or "Nul" got a project row and a
 * repository folder that could never be created — every turn after that failed.
 * Those are given a suffix. Docker on Linux would not mind, but development and
 * some installations run here.
 *
 * Deliberately free of imports so `npm test` can load it directly.
 */

const RESERVED = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;

export function baseSlug(name: string): string {
	const base =
		name
			.toLowerCase()
			.normalize('NFD')
			.replace(/\p{Diacritic}/gu, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 48) || 'app';
	return RESERVED.test(base) ? `${base}-app` : base;
}

/** The first free slug for `name`, counting up from 2 while `taken` says so. */
export function uniqueSlug(name: string, taken: (slug: string) => boolean): string {
	const base = baseSlug(name);
	let slug = base;
	let n = 2;
	while (taken(slug)) slug = `${base}-${n++}`;
	return slug;
}
