// The stats server's labelled track examples, cached in IndexedDB so the (~2 MB) download
// only happens when they change on the server.

import { fetchTrackExamples } from './api.js';
import { statsSettings } from './settings.js';

const DB_NAME = 'mm-stats-tracks';
const STORE = 'kv';
const KEY = 'examples';

/** @typedef {{server:string, version:string, examples:import('./recognizer.js').Example[]}} Cached */

/** @returns {Promise<IDBDatabase>} */
function openDb() {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

/** @returns {Promise<Cached|null>} */
async function readCache() {
	try {
		const db = await openDb();
		return await new Promise(resolve => {
			const req = db.transaction(STORE).objectStore(STORE).get(KEY);
			req.onsuccess = () => resolve(req.result ?? null);
			req.onerror = () => resolve(null);
		});
	} catch { return null; }
}

/** @param {Cached} value */
async function writeCache(value) {
	try {
		const db = await openDb();
		await new Promise(resolve => {
			const tx = db.transaction(STORE, 'readwrite');
			tx.objectStore(STORE).put(value, KEY);
			tx.oncomplete = tx.onerror = () => resolve(undefined);
		});
	} catch { /* storage unavailable: download again next time */ }
}

/**
 * The current examples: from the cache if the server says they're unchanged (or can't be reached).
 * @returns {Promise<import('./recognizer.js').Example[]>}
 */
export async function loadExamples() {
	const server = statsSettings.serverUrl;
	const cached = await readCache();
	const mine = cached && cached.server === server ? cached : null;
	try {
		const res = await fetchTrackExamples(mine?.version);
		if (res.unchanged && mine) return mine.examples;
		const examples = res.examples ?? [];
		await writeCache({ server, version: res.version, examples });
		return examples;
	} catch (e) {
		if (mine) { console.warn('[tracks] using cached examples:', /** @type {Error} */(e).message); return mine.examples; }
		throw e;
	}
}
