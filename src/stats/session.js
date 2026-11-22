// Per-mogi stats state (session ID, track labels, self) and the schemaVersion 1 export.

/**
 * @typedef {import("../mogi.js").Mogi} Mogi
 * @typedef {import("../race.js").Race} Race
 * @typedef {import("./tracks.js").TrackList} TrackList
 * @typedef {import("./api.js").SendResult} SendResult
 */

import { toLetter } from '../util.js';
import { splitLabel, UNKNOWN_ABBR } from './tracks.js';

export const SCHEMA_VERSION = 1;
export const CLIENT_NAME = 'mkw-mogi-manager-fork';
export const CLIENT_VERSION = '1.0.0';

function uuidv4() {
	if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
	const b = crypto.getRandomValues(new Uint8Array(16));
	b[6] = (b[6] & 0x0f) | 0x40;
	b[8] = (b[8] & 0x3f) | 0x80;
	const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Fired on a StatsSession whenever a race's track label or guesses change. */
export const LABELS_CHANGED_EVENT = 'labels';

export class StatsSession extends EventTarget {
	/** Stable for this mogi; re-sends upsert on the server. */
	sessionId = uuidv4();
	/** @type {Map<number, string>} race timestamp => track abbr ("?" = unknown) */
	labels = new Map();
	/** @type {Set<number>} races whose label the user set (never overwritten by recognition) */
	manual = new Set();
	/** @type {Map<number, string[]>} race timestamp => recognised tracks, best first */
	guesses = new Map();
	/** @type {string|null} Lounge name of the user, chosen from the roster */
	selfName = null;
	/** @type {SendResult|null} */
	lastResult = null;
	/** Has the server accepted this session at least once? */
	sent = false;
	/** Has the "click Stats" hint been shown since the mogi ended? */
	endHintShown = false;

	/** @param {Mogi} mogi */
	constructor(mogi) {
		super();
		this.mogi = mogi;
	}

	/** Counted races, in the order they counted (redone races are never recorded). */
	get races() { return this.mogi.races; }

	/** @param {Race} race */
	labelOf(race) { return this.labels.get(race.timestamp) ?? null; }

	/**
	 * @param {Race} race
	 * @param {string} abbr
	 */
	setLabel(race, abbr) {
		this.labels.set(race.timestamp, abbr);
		this.manual.add(race.timestamp);
		this.dispatchEvent(new Event(LABELS_CHANGED_EVENT));
	}

	/**
	 * Store recognised tracks for a race; the best one becomes its label unless the user set one.
	 * @param {Race} race
	 * @param {string[]} guesses best first
	 */
	setGuesses(race, guesses) {
		this.guesses.set(race.timestamp, guesses);
		if (!this.manual.has(race.timestamp) && guesses.length) this.labels.set(race.timestamp, guesses[0]);
		this.dispatchEvent(new Event(LABELS_CHANGED_EVENT));
	}

	/** @param {Race} race */
	guessesOf(race) { return this.guesses.get(race.timestamp) ?? []; }

	/** Label came from recognition and the user hasn't touched it. @param {Race} race */
	isAutoLabel(race) { return this.labels.has(race.timestamp) && !this.manual.has(race.timestamp); }

	get labeledCount() { return this.races.filter(r => this.labels.has(r.timestamp)).length; }

	/** Roster player for the chosen self name, if still in the roster. */
	get selfPlayer() {
		if (!this.selfName) return null;
		return [...this.mogi.roster].find(p => p.name === this.selfName) ?? null;
	}

	/**
	 * The user's own placement and points in a race, for context while labeling.
	 * @param {Race} race
	 */
	selfResult(race) {
		const p = this.selfPlayer;
		if (!p) return null;
		const row = race.placements.find(r => r.playerId === p.id);
		if (!row) return null;
		return { placement: row.placement, points: row.score, dc: row.dc };
	}

	get format() {
		const ppt = this.mogi.playersPerTeam; // wars are never exported (see index.js)
		return ppt <= 1 ? 'FFA' : `${ppt}v${ppt}`;
	}

	/**
	 * Build the export payload (shared contract §4.2, schemaVersion 1).
	 * @param {TrackList} tracks
	 * @param {number|null} loungePlayerId
	 */
	buildPayload(tracks, loungePlayerId) {
		const mogi = this.mogi;
		const roster = [...mogi.roster];
		const nameById = new Map(roster.map(p => [p.id, p.name]));
		const races = this.races;
		const scores = mogi.calculatePlayerScores();
		const teamOf = (/** @type {import("../player.js").Player} */ p) => {
			if (mogi.playersPerTeam <= 1) return null;
			return mogi.teamBySeed(p.seed)?.tag || toLetter(p.seed);
		};

		return {
			schemaVersion: SCHEMA_VERSION,
			sessionId: this.sessionId,
			client: { name: CLIENT_NAME, version: CLIENT_VERSION },
			startedAt: mogi.startDate.toISOString(),
			finishedAt: races.length ? new Date(/** @type {Race} */(races.at(-1)).timestamp).toISOString() : null,
			game: 'mkworld12p',
			playerCount: roster.length,
			format: this.format,
			self: { loungeName: this.selfName, loungePlayerId },
			roster: roster.map((p, i) => ({
				slot: i + 1,
				loungeName: p.name,
				mmr: p.mmr > 0 ? p.mmr : null,
				team: teamOf(p),
			})),
			races: races.map((race, i) => {
				// Connecting tracks are stored as "FROM>TO": abbr = destination, from = origin, routeType = "connecting".
				const { abbr, from, connecting } = splitLabel(this.labelOf(race) ?? UNKNOWN_ABBR);
				const track = abbr === UNKNOWN_ABBR ? null : tracks.byAbbr(abbr);
				const seen = new Set();
				const results = race.placements
					.filter(row => row.playerId && nameById.has(row.playerId))
					.map(row => {
						seen.add(row.playerId);
						return {
							loungeName: /** @type {string} */(nameById.get(/** @type {string} */(row.playerId))),
							placement: /** @type {number|null} */(row.placement),
							points: row.score,
							status: row.dc ? 'dc' : 'ok',
						};
					});
				for (const p of roster) {
					if (!seen.has(p.id)) results.push({ loungeName: p.name, placement: null, points: 0, status: 'absent' });
				}
				return {
					raceNumber: i + 1,
					track: {
						abbr,
						name: track?.name ?? (abbr === UNKNOWN_ABBR ? 'Unknown' : abbr),
						from: connecting && from !== UNKNOWN_ABBR ? from : null,
						routeType: connecting ? 'connecting' : null,
					},
					results,
					capturedAt: new Date(race.timestamp).toISOString(),
					edited: race.edited,
				};
			}),
			finalScores: roster.map(p => ({ loungeName: p.name, score: scores.get(p.id) ?? 0 })),
			notes: null,
		};
	}

	/** `mogi-<YYYYMMDD-HHmm>-<sessionId first 8>.json` */
	get fileName() {
		const d = this.mogi.startDate;
		const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
		return `mogi-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}-${this.sessionId.slice(0, 8)}.json`;
	}
}

/**
 * Trigger a browser download of a JSON payload.
 * @param {object} payload
 * @param {string} fileName
 */
export function downloadJson(payload, fileName) {
	const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 2000);
}
