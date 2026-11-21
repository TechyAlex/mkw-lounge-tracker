// Local outbox (IndexedDB) for stats uploads that could not be delivered
// (offline, server down, CORS / local-network-access blocked, rate limited).
// Retried quietly when the app opens, when the browser comes back online and after a mogi is sent.

import { postSession } from './api.js';
import { statsSettings } from './settings.js';

const DB_NAME = 'mm-stats';
const STORE = 'outbox';

/**
 * @typedef {Object} OutboxEntry
 * @prop {string} sessionId
 * @prop {any} payload
 * @prop {string} fileName
 * @prop {string} queuedAt
 * @prop {number} attempts
 * @prop {string|null} lastError
 * @prop {boolean} needsAttention The server rejected it (401/4xx); not retried automatically except after a settings change
 */

/** @type {Promise<IDBDatabase>|null} */
let dbPromise = null;

function openDb() {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'sessionId' });
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => { dbPromise = null; reject(req.error); };
	});
	return dbPromise;
}

/**
 * @template T
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest<T>} fn
 * @returns {Promise<T>}
 */
async function withStore(mode, fn) {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, mode);
		const req = fn(tx.objectStore(STORE));
		tx.oncomplete = () => resolve(req.result);
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}

/** @returns {Promise<OutboxEntry[]>} */
export async function listOutbox() {
	try { return await withStore('readonly', s => s.getAll()); } catch { return []; }
}

/**
 * Queue (or replace) a payload. Same sessionId = same mogi, newest payload wins.
 * @param {any} payload
 * @param {string} fileName
 * @param {string} error
 * @param {boolean} [needsAttention]
 */
export async function enqueue(payload, fileName, error, needsAttention = false) {
	const existing = (await listOutbox()).find(e => e.sessionId === payload.sessionId);
	/** @type {OutboxEntry} */
	const entry = {
		sessionId: payload.sessionId,
		payload,
		fileName,
		queuedAt: existing?.queuedAt ?? new Date().toISOString(),
		attempts: (existing?.attempts ?? 0) + 1,
		lastError: error,
		needsAttention,
	};
	try { await withStore('readwrite', s => s.put(entry)); } catch (e) { console.warn('Could not save to stats outbox', e); }
}

/** @param {string} sessionId */
export async function removeFromOutbox(sessionId) {
	try { await withStore('readwrite', s => s.delete(sessionId)); } catch { /* ignore */ }
}

export async function clearOutbox() {
	try { await withStore('readwrite', s => s.clear()); } catch { /* ignore */ }
}

let flushing = false;

/**
 * Try to deliver everything in the outbox.
 * @param {{includeRejected?: boolean}} [opts] Also retry entries the server rejected before (e.g. after fixing the token)
 * @returns {Promise<{sent:number, remaining:number}>}
 */
export async function flushOutbox(opts = {}) {
	if (flushing || !statsSettings.serverConfigured) return { sent: 0, remaining: (await listOutbox()).length };
	flushing = true;
	let sent = 0;
	try {
		for (const entry of await listOutbox()) {
			if (entry.needsAttention && !opts.includeRejected) continue;
			const res = await postSession(entry.payload);
			if (res.kind === 'pending' || res.kind === 'linked') {
				await removeFromOutbox(entry.sessionId);
				sent++;
			} else if (res.kind === 'retry') {
				await enqueue(entry.payload, entry.fileName, res.message);
				break; // server unreachable; don't hammer it with the rest
			} else {
				await enqueue(entry.payload, entry.fileName, res.message, true);
			}
		}
	} finally {
		flushing = false;
	}
	return { sent, remaining: (await listOutbox()).length };
}
