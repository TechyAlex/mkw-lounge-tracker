// Live track recognition: each captured race's frame is fingerprinted as it comes in and
// matched against the stats server's labelled examples. All races of the mogi are ranked
// together (one pick per race, a soft penalty for repeating a track), and the best guess
// becomes the race's label unless the user has set one. Only runs when linked to a server.

/**
 * @typedef {import("./session.js").StatsSession} StatsSession
 * @typedef {import("./recognizer.js").Fingerprints} Fingerprints
 * @typedef {import("./recognizer.js").Scored} Scored
 */

import { loadExamples } from './examples.js';
import { fingerprintFrame, loadModel, makeScorer, suggestForMogi } from './recognizer.js';
import { splitLabel, UNKNOWN_ABBR } from './tracks.js';

export const RECOGNIZER_STATUS_EVENT = 'status';

export class TrackRecognizer extends EventTarget {
	/** @type {'idle'|'loading'|'ready'|'error'} */
	status = 'idle';
	message = '';
	exampleCount = 0;
	/** @type {((q: Fingerprints) => Scored[])|null} */
	#scorer = null;
	/** @type {Map<number, Scored[]|null>} race timestamp => scores (null = couldn't read) */
	#scores = new Map();
	/** @type {Set<number>} */
	#working = new Set();
	#queue = Promise.resolve();

	/** @param {StatsSession} session */
	constructor(session) {
		super();
		this.session = session;
	}

	/** @param {TrackRecognizer['status']} status @param {string} message */
	#setStatus(status, message) {
		this.status = status;
		this.message = message;
		this.dispatchEvent(new Event(RECOGNIZER_STATUS_EVENT));
	}

	/** Download the examples and warm up the image model (once). */
	async start() {
		if (this.status === 'loading' || this.status === 'ready') return;
		this.#setStatus('loading', 'Loading track recognition…');
		try {
			const examples = await loadExamples();
			if (!examples.length) throw new Error('the server has no labelled track examples yet');
			this.#scorer = makeScorer(examples);
			this.exampleCount = examples.length;
			// The palette alone still works if the model can't load (much less accurate).
			const modelOk = await loadModel().then(() => true, () => false);
			this.#setStatus('ready', modelOk
				? `Recognising tracks from ${examples.length} labelled races`
				: `Image model unavailable: recognising by colour only (less accurate)`);
			this.update();
		} catch (e) {
			this.#scorer = null;
			this.#setStatus('error', `Track recognition off: ${/** @type {Error} */(e).message}`);
		}
	}

	/** Forget the examples and scores (the server changed); start() loads them again. */
	reset() {
		this.#scorer = null;
		this.#scores.clear();
		this.#setStatus('idle', '');
	}

	/** Recognise any new races, then re-rank the whole mogi. Call whenever the races change. */
	update() {
		if (!this.#scorer) return;
		const scorer = this.#scorer;
		for (const race of this.session.races) {
			const ts = race.timestamp;
			if (this.#scores.has(ts) || this.#working.has(ts)) continue;
			this.#working.add(ts);
			// One at a time: the image model is the slow part and shares the GPU with the video.
			this.#queue = this.#queue.then(async () => {
				try {
					this.#scores.set(ts, race.snapshotUrl ? scorer(await fingerprintFrame(race.snapshotUrl)) : null);
				} catch (e) {
					console.warn('[tracks] could not read race frame', e);
					this.#scores.set(ts, null);
				} finally {
					this.#working.delete(ts);
				}
				this.#rank();
			});
		}
		this.#rank();
	}

	/** One pick per race across the mogi; tracks the user set count as taken. */
	#rank() {
		const session = this.session;
		const races = session.races;
		const typed = races.filter(r => session.manual.has(r.timestamp))
			.map(r => splitLabel(session.labelOf(r) ?? UNKNOWN_ABBR).abbr)
			.filter(a => a !== UNKNOWN_ABBR);
		const scored = races
			.map(r => ({ key: r, scores: this.#scores.get(r.timestamp) }))
			.filter(/** @returns {x is {key: any, scores: Scored[]}} */ x => !!x.scores?.length)
			.filter(x => !session.manual.has(x.key.timestamp));
		const picks = suggestForMogi(scored, typed, 3);
		for (const r of races) {
			const s = this.#scores.get(r.timestamp);
			// A race you set keeps the guesses you picked from (so the buttons don't jump around);
			// if you set it before it was recognised, it gets its own unpenalised top 3.
			const manual = session.manual.has(r.timestamp);
			if (manual && session.guessesOf(r).length) continue;
			const guesses = picks.get(r) ?? (manual && s ? s.slice(0, 3).map(([t]) => t) : null);
			if (!guesses) continue;
			const old = session.guessesOf(r);
			if (old.length === guesses.length && old.every((g, i) => g === guesses[i])) continue;
			session.setGuesses(r, guesses);
		}
	}

	/** Is this race's frame still being read? @param {number} ts */
	isWorking(ts) { return this.#working.has(ts); }
}
