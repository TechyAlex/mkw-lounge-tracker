// Track list for labeling. Source of truth is the stats server (GET /api/tracks);
// a cached copy lives in localStorage, and ./tracks.json is the bundled fallback.

import { fetchTracks } from './api.js';
import { statsSettings } from './settings.js';

/**
 * @typedef {Object} Track
 * @prop {string} abbr Uppercase abbreviation, the track's identifier
 * @prop {string} name
 * @prop {string|null} cup
 * @prop {boolean} isRetro
 * @prop {string|null} origin
 * @prop {string[]} aliases Uppercase
 */

export const UNKNOWN_ABBR = '?';

/**
 * Separator for connecting tracks (the route between two tracks), typed as FROM>TO, e.g. "MBC>CC".
 * A race label is stored as "ABBR", "?" or "FROM>TO".
 */
export const CONNECTING_SEPARATOR = '>';

/**
 * @param {string} label Stored race label
 * @returns {{abbr:string, from:string|null, connecting:boolean}} abbr = destination track for connecting routes
 */
export function splitLabel(label) {
	const i = label.indexOf(CONNECTING_SEPARATOR);
	if (i < 0) return { abbr: label, from: null, connecting: false };
	return { abbr: label.slice(i + 1), from: label.slice(0, i), connecting: true };
}

/** @type {Track[]|null} */
let bundled = null;
let lastBackgroundRefresh = 0;

/**
 * @param {unknown} raw
 * @returns {Track[]}
 */
function sanitize(raw) {
	if (!Array.isArray(raw)) throw new Error('Track list is not an array');
	/** @type {Track[]} */
	const out = [];
	for (const t of raw) {
		if (!t || typeof t !== 'object') continue;
		const abbr = String(t.abbr ?? '').trim().toUpperCase();
		const name = String(t.name ?? '').trim();
		if (!abbr || !name || abbr === UNKNOWN_ABBR) continue;
		out.push({
			abbr, name,
			cup: typeof t.cup === 'string' ? t.cup : null,
			isRetro: !!t.isRetro,
			origin: typeof t.origin === 'string' ? t.origin : null,
			aliases: Array.isArray(t.aliases) ? t.aliases.map((/** @type {unknown} */ a) => String(a).trim().toUpperCase()).filter(Boolean) : [],
		});
	}
	return out;
}

async function loadBundled() {
	if (bundled) return bundled;
	try {
		const res = await fetch(new URL('./tracks.json', import.meta.url));
		bundled = sanitize(await res.json());
	} catch (e) {
		console.warn('Could not load bundled tracks.json', e);
		bundled = [];
	}
	return bundled;
}

/** @returns {Track[]|null} */
function readCache() {
	const raw = statsSettings.tracksCache;
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (parsed?.server !== statsSettings.serverUrl) return null;
		const list = sanitize(parsed.tracks);
		return list.length ? list : null;
	} catch { return null; }
}

/**
 * Fetch the list from the configured server and cache it.
 * @param {string} [server]
 * @returns {Promise<Track[]>}
 */
export async function refreshTracksFromServer(server) {
	const list = sanitize(await fetchTracks(server));
	if (!list.length) throw new Error('Server returned an empty track list');
	statsSettings.tracksCache = JSON.stringify({ server: server ?? statsSettings.serverUrl, fetchedAt: new Date().toISOString(), tracks: list });
	return list;
}

/**
 * Current best track list: server (cached, refreshed in the background) or the bundled fallback.
 * @returns {Promise<TrackList>}
 */
export async function loadTracks() {
	if (statsSettings.serverConfigured) {
		const cached = readCache();
		if (cached) {
			if (Date.now() - lastBackgroundRefresh > 5 * 60 * 1000) {
				lastBackgroundRefresh = Date.now();
				refreshTracksFromServer().catch(() => { /* keep cache */ });
			}
			return new TrackList(cached, 'server (cached)');
		}
		try {
			return new TrackList(await refreshTracksFromServer(), 'server');
		} catch (e) {
			console.warn('Could not fetch tracks from the stats server, using bundled list', e);
		}
	}
	return new TrackList(await loadBundled(), 'bundled');
}

export class TrackList {
	/** @type {Track[]} */ tracks;
	/** @type {string} */ source;
	/** @type {Map<string, Track>} */ #lookup = new Map();

	/**
	 * @param {Track[]} tracks
	 * @param {string} source
	 */
	constructor(tracks, source) {
		this.tracks = tracks;
		this.source = source;
		for (const t of tracks) this.#lookup.set(t.abbr, t);
		for (const t of tracks) for (const a of t.aliases) if (!this.#lookup.has(a)) this.#lookup.set(a, t);
	}

	/**
	 * Resolve typed input (case-insensitive abbreviation or alias).
	 * @param {string} input
	 * @returns {Track|null}
	 */
	resolve(input) {
		return this.#lookup.get(input.trim().toUpperCase()) ?? null;
	}

	/**
	 * Resolve a whole typed label: "bc", "?", or a connecting route "mbc>cc" (either side may be "?").
	 * @param {string} input
	 * @returns {string|null} Canonical label, or null if any part is unknown
	 */
	resolveLabel(input) {
		const value = input.trim().replace(/\s*(?:→|->)\s*/g, CONNECTING_SEPARATOR).replace(/\s*>\s*/g, CONNECTING_SEPARATOR);
		/** @param {string} part */
		const one = part => part.trim() === UNKNOWN_ABBR ? UNKNOWN_ABBR : (this.resolve(part)?.abbr ?? null);
		const parts = value.split(CONNECTING_SEPARATOR);
		if (parts.length > 2) return null;
		if (parts.length === 1) return value ? one(value) : null;
		const [from, to] = parts.map(one);
		if (!from || !to) return null;
		return `${from}${CONNECTING_SEPARATOR}${to}`;
	}

	/**
	 * Human-readable description of a stored label.
	 * @param {string} label
	 */
	describeLabel(label) {
		/** @param {string} abbr */
		const nameOf = abbr => abbr === UNKNOWN_ABBR ? 'unknown track' : (this.byAbbr(abbr) ? trackLabel(/** @type {Track} */(this.byAbbr(abbr))) : abbr);
		const { abbr, from, connecting } = splitLabel(label);
		if (connecting) return `Connecting track: ${nameOf(/** @type {string} */(from))} → ${nameOf(abbr)}`;
		if (abbr === UNKNOWN_ABBR) return 'Unknown — left out of track stats';
		return nameOf(abbr);
	}

	/** @param {string} abbr */
	byAbbr(abbr) {
		return this.tracks.find(t => t.abbr === abbr) ?? null;
	}

	/**
	 * Autocomplete suggestions, best first.
	 * @param {string} input
	 * @param {number} [limit]
	 * @returns {Track[]}
	 */
	suggest(input, limit = 6) {
		const q = input.trim().toUpperCase();
		if (!q || q === UNKNOWN_ABBR) return [];
		/** @param {Track} t */
		const rank = t => {
			if (t.abbr === q) return 0;
			if (t.aliases.includes(q)) return 1;
			if (t.abbr.startsWith(q)) return 2;
			if (t.aliases.some(a => a.startsWith(q))) return 3;
			const name = t.name.toUpperCase();
			if (name.split(/[\s.'-]+/).some(w => w.startsWith(q))) return 4;
			if (name.includes(q)) return 5;
			if (q.length >= 2 && levenshtein(q, t.abbr) <= 1) return 6;
			return -1;
		};
		return this.tracks
			.map(t => ({ t, r: rank(t) }))
			.filter(x => x.r >= 0)
			.sort((a, b) => a.r - b.r || a.t.abbr.localeCompare(b.t.abbr))
			.slice(0, limit)
			.map(x => x.t);
	}
}

/** @param {Track} t */
export function trackLabel(t) {
	const retro = t.isRetro ? ` (retro${t.origin ? `, ${t.origin}` : ''})` : '';
	return `${t.name}${retro}`;
}

/**
 * @param {string} a
 * @param {string} b
 */
function levenshtein(a, b) {
	const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		let prev = dp[0];
		dp[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const tmp = dp[j];
			dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
			prev = tmp;
		}
	}
	return dp[b.length];
}
