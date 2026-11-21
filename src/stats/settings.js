// Opt-in "stats server" settings. Everything is stored in this browser's localStorage only;
// nothing here is ever committed or sent anywhere unless a server URL has been entered.

export const KEYS = {
	serverUrl: 'mm.stats.serverUrl',
	token: 'mm.stats.token',
	labeling: 'mm.stats.labeling', // 'on' | 'off' | unset (default: on iff a server is configured)
	tracksCache: 'mm.stats.tracksCache',
	selfName: 'mm.self.loungeName',
	selfPlayerId: 'mm.self.loungePlayerId',
};

export const SETTINGS_CHANGED_EVENT = 'mm-stats-settings-changed';

/** @param {string} key */
function get(key) {
	try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
}
/**
 * @param {string} key
 * @param {string} value
 */
function set(key, value) {
	try {
		if (value === '') localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch { /* storage unavailable (private mode etc.) */ }
}

/**
 * Validate and normalise a server URL. HTTPS is required, except plain http on
 * localhost for development against a local server.
 * @param {string} raw
 * @returns {{ok:true, url:string}|{ok:false, error:string}}
 */
export function normalizeServerUrl(raw) {
	const trimmed = raw.trim();
	if (!trimmed) return { ok: true, url: '' };
	let u;
	try { u = new URL(trimmed); } catch { return { ok: false, error: 'Not a valid URL.' }; }
	const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.hostname.endsWith('.localhost');
	if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocal)) {
		return { ok: false, error: 'The server URL must start with https://' };
	}
	if (u.search || u.hash) return { ok: false, error: 'Leave out any ?query or #fragment.' };
	return { ok: true, url: (u.origin + u.pathname).replace(/\/+$/, '') };
}

export const statsSettings = {
	get serverUrl() { return get(KEYS.serverUrl); },
	set serverUrl(v) { set(KEYS.serverUrl, v); },

	get token() { return get(KEYS.token); },
	set token(v) { set(KEYS.token, v); },

	/** @returns {'on'|'off'|''} */
	get labelingSetting() {
		const v = get(KEYS.labeling);
		return v === 'on' || v === 'off' ? v : '';
	},
	set labelingSetting(v) { set(KEYS.labeling, v); },

	/** True when a stats server URL is configured (sending is on). */
	get serverConfigured() { return this.serverUrl !== ''; },

	/** Track labeling defaults to on only when a stats server is configured. */
	get labelingEnabled() {
		const v = this.labelingSetting;
		if (v) return v === 'on';
		return this.serverConfigured;
	},

	/** Show the stats features at all (button on the scoreboard, finish flow). */
	get featureEnabled() { return this.serverConfigured || this.labelingEnabled; },

	get selfName() { return get(KEYS.selfName); },
	set selfName(v) { set(KEYS.selfName, v); },

	/** @returns {number|null} */
	get selfPlayerId() {
		const v = get(KEYS.selfPlayerId).trim();
		return /^\d+$/.test(v) ? Number(v) : null;
	},
	/** @param {number|null} v */
	set selfPlayerId(v) { set(KEYS.selfPlayerId, v === null ? '' : String(v)); },

	get tracksCache() { return get(KEYS.tracksCache); },
	set tracksCache(v) { set(KEYS.tracksCache, v); },
};

export function notifySettingsChanged() {
	window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
}
