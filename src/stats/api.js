// Client for the MKW Advanced Stats server (shared contract, schemaVersion 1).
// Only ever called when the user has configured a server URL.

import { statsSettings } from './settings.js';

const TIMEOUT_MS = 15000;

/**
 * @typedef {Object} SendResult
 * @prop {'pending'|'linked'|'unauthorized'|'invalid'|'retry'} kind
 *   pending/linked = stored on the server; unauthorized/invalid = the user must fix something;
 *   retry = network error, CORS/local-network block, 429 or 5xx (keep locally and retry later)
 * @prop {string} message Human-readable summary
 * @prop {string|null} [status] Server status string, if any
 * @prop {string|number|null} [tableId]
 * @prop {number} [httpStatus]
 */

/**
 * @param {string} path
 * @param {RequestInit} [init]
 * @param {{auth?:boolean, server?:string, token?:string}} [opts]
 */
async function request(path, init = {}, opts = {}) {
	const server = opts.server ?? statsSettings.serverUrl;
	if (!server) throw new Error('No stats server configured');
	const headers = new Headers(init.headers);
	if (opts.auth !== false) headers.set('Authorization', `Bearer ${opts.token ?? statsSettings.token}`);
	return fetch(server + path, {
		...init,
		headers,
		mode: 'cors',
		credentials: 'omit',
		cache: 'no-store',
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
}

/** @param {Response} res */
async function readJson(res) {
	try { return await res.json(); } catch { return null; }
}

/**
 * Turn a server error body into something readable.
 * @param {any} body
 * @param {number} status
 */
function describeError(body, status) {
	if (!body || typeof body !== 'object') return `HTTP ${status}`;
	const parts = [];
	const msg = body.message ?? body.error ?? body.detail;
	if (typeof msg === 'string') parts.push(msg);
	for (const key of ['unknownTracks', 'unknown', 'abbrs']) {
		if (Array.isArray(body[key]) && body[key].length) parts.push(`${key}: ${body[key].join(', ')}`);
	}
	if (Array.isArray(body.errors)) {
		parts.push(...body.errors.slice(0, 5).map((/** @type {any} */ e) =>
			typeof e === 'string' ? e : [e.path ?? e.field, e.message ?? e.msg].filter(Boolean).join(': ')));
	} else if (body.errors && typeof body.errors === 'object') {
		parts.push(...Object.entries(body.errors).slice(0, 5).map(([k, v]) => `${k}: ${v}`));
	}
	return parts.length ? parts.join(' — ') : `HTTP ${status}`;
}

/**
 * @param {string|null|undefined} status
 * @param {string|number|null|undefined} tableId
 */
export function describeStatus(status, tableId) {
	switch (status) {
		case 'pending': return 'Sent ✓ — waiting for the Lounge table';
		case 'matched_provisional': return `Linked to table #${tableId ?? '?'} (provisional)`;
		case 'confirmed': return `Linked to table #${tableId ?? '?'}`;
		default: return `Server status: ${status ?? 'unknown'}`;
	}
}

/**
 * POST a session export.
 * @param {object} payload
 * @returns {Promise<SendResult>}
 */
export async function postSession(payload) {
	let res;
	try {
		res = await request('/api/import/sessions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});
	} catch (e) {
		// Network error, timeout, CORS failure or a denied local-network-access prompt all land here.
		console.warn('Stats upload failed', e);
		return { kind: 'retry', message: 'Could not reach the stats server.' };
	}
	const body = await readJson(res);
	if (res.status === 202 || res.status === 200) {
		const status = body?.status ?? (res.status === 202 ? 'pending' : null);
		const tableId = body?.tableId ?? null;
		return {
			kind: status === 'matched_provisional' || status === 'confirmed' ? 'linked' : 'pending',
			message: describeStatus(status, tableId), status, tableId, httpStatus: res.status,
		};
	}
	if (res.status === 401) return { kind: 'unauthorized', message: 'Upload token rejected — check the stats server settings.', httpStatus: 401 };
	if (res.status === 429) return { kind: 'retry', message: 'Rate limited by the stats server.', httpStatus: 429 };
	if (res.status >= 500) return { kind: 'retry', message: `Stats server error (HTTP ${res.status}).`, httpStatus: res.status };
	if (res.status === 413) return { kind: 'invalid', message: 'Export too large for the server.', httpStatus: 413 };
	return { kind: 'invalid', message: describeError(body, res.status), httpStatus: res.status };
}

/**
 * @param {string} sessionId
 * @returns {Promise<{ok:true, status:string, tableId:string|number|null, reason:string|null}|{ok:false, notFound?:boolean, message:string}>}
 */
export async function getSessionStatus(sessionId) {
	try {
		const res = await request(`/api/import/sessions/${encodeURIComponent(sessionId)}`);
		if (res.status === 404) return { ok: false, notFound: true, message: 'Not on the server yet.' };
		if (res.status === 401) return { ok: false, message: 'Upload token rejected.' };
		if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
		const body = await readJson(res);
		return { ok: true, status: body?.status ?? 'unknown', tableId: body?.tableId ?? null, reason: body?.reason ?? null };
	} catch {
		return { ok: false, message: 'Could not reach the stats server.' };
	}
}

/**
 * @param {string} server
 * @param {string} token
 * @returns {Promise<{ok:boolean, message:string}>}
 */
export async function ping(server, token) {
	try {
		const res = await request('/api/import/ping', {}, { server, token });
		if (res.status === 401) return { ok: false, message: 'Reached the server, but the upload token was rejected.' };
		const body = await readJson(res);
		if (res.ok && body?.ok === true) {
			const versions = Array.isArray(body.schemaVersions) ? body.schemaVersions : [];
			if (versions.length && !versions.includes(1)) {
				return { ok: false, message: `Server does not accept schemaVersion 1 (supports ${versions.join(', ')}).` };
			}
			return { ok: true, message: `Connected to ${body.server ?? 'stats server'} ✓` };
		}
		return { ok: false, message: `Unexpected response (HTTP ${res.status}).` };
	} catch (e) {
		console.warn('Stats ping failed', e);
		return { ok: false, message: 'Could not reach the server (offline, blocked by CORS, or local network access was denied).' };
	}
}

/**
 * @param {string} [server]
 * @returns {Promise<unknown>} Raw JSON (validated by the caller)
 */
export async function fetchTracks(server) {
	const res = await request('/api/tracks', {}, { auth: false, ...(server ? { server } : {}) });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
}
