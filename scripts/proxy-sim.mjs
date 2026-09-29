/**
 * Stand in for the authenticating reverse proxy, for local testing.
 *
 * Specman signs someone in from `X-Forwarded-User` when it is deployed behind a
 * gateway that has already authenticated them. There is no way to exercise that
 * path — or anything behind sign-in — from a browser on a developer's machine
 * without something in front putting the header there. This is that something.
 *
 * It **overwrites** the forwarded headers rather than passing through whatever
 * the client sent, which is the behaviour the real deployment must also have.
 * Treating that as the default here means a test cannot accidentally pass
 * against a proxy that merely appends.
 *
 *   node scripts/proxy-sim.mjs --port 6001 --target http://127.0.0.1:5199 --user novak.jan
 *
 * For testing only. Never put this in front of anything real: it authenticates
 * nobody and will happily call you whatever the command line says.
 */
import { createServer } from 'node:http';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
	args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}

const port = Number(args.get('port') ?? 6001);
const target = args.get('target') ?? 'http://127.0.0.1:5199';
const user = args.get('user') ?? 'novak.jan';
const name = args.get('name') ?? user;
const email = args.get('email') ?? `${user}@example.com`;

const server = createServer(async (request, response) => {
	const url = new URL(request.url, target);

	const headers = new Headers();
	for (const [key, value] of Object.entries(request.headers)) {
		// Anything the client sent under these names is dropped before ours go on,
		// which is the whole point of the exercise.
		if (key.toLowerCase().startsWith('x-forwarded-')) continue;
		if (key.toLowerCase() === 'host' || key.toLowerCase() === 'connection') continue;
		headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
	}

	headers.set('x-forwarded-user', user);
	headers.set('x-forwarded-email', email);
	headers.set('x-forwarded-preferred-username', name);

	const body =
		request.method === 'GET' || request.method === 'HEAD'
			? undefined
			: await new Promise((resolve) => {
					const chunks = [];
					request.on('data', (chunk) => chunks.push(chunk));
					request.on('end', () => resolve(Buffer.concat(chunks)));
				});

	try {
		const upstream = await fetch(new URL(url.pathname + url.search, target), {
			method: request.method,
			headers,
			body,
			redirect: 'manual',
			duplex: 'half'
		});

		const out = new Headers(upstream.headers);
		out.delete('content-encoding');
		out.delete('content-length');
		response.writeHead(upstream.status, Object.fromEntries(out));

		if (upstream.body) {
			// Piped rather than buffered: a turn is a stream that stays open for
			// half a minute, and buffering it would hide exactly what we came to see.
			for await (const chunk of upstream.body) response.write(chunk);
		}
		response.end();
	} catch (cause) {
		response.writeHead(502, { 'content-type': 'text/plain' });
		response.end(`proxy-sim could not reach ${target}: ${cause}`);
	}
});

server.listen(port, '127.0.0.1', () => {
	console.log(`proxy-sim: http://127.0.0.1:${port} -> ${target}, as "${user}" (${name})`);
});
