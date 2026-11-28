// "This room" (top of the live panel, only while linked to a stats server): from the room list,
// - your MMR change for each place you could finish (the Lounge formula), where you'd finish if
//   the room finished in MMR order, and where you stand right now;
// - people in the room you have a history with: opponents who usually finish above you or below
//   you, and how you do with your teammates.
// Open before race 1, folded once the mogi is under way (click to reopen).

/**
 * @typedef {import("../session.js").StatsSession} StatsSession
 * @typedef {import("../../player.js").Player} Player
 */

import { fmt } from '../../i18n/i18n.js';
import { fetchRoom } from '../api.js';
import { statsSettings } from '../settings.js';
import { el } from './dom.js';

const OTHERS_SHOWN = 6;

const nf = new Intl.NumberFormat('en-US');
/** @param {number|null|undefined} x */
const signed = x => x == null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : '±'}${nf.format(Math.abs(Math.round(x)))}`;
/** @param {number} n */
const place = n => fmt.place(n).trim();

/**
 * @param {StatsSession} session
 * @param {() => Player|null} me The user's roster player, if known
 * @returns {{ element: HTMLElement, refresh: () => void }}
 */
export function createRoomPanel(session, me) {
	const mogi = session.mogi;
	/** @type {any} */ let room = null;
	let error = '';
	let loadedKey = '';
	let loadingKey = '';
	let userToggled = false;
	let wasStarted = false;

	const summaryNote = el('span', { class: 'muted stats-room-sum' });
	const body = el('div', { class: 'stats-room-body' });
	const details = /** @type {HTMLDetailsElement} */(el('details', { class: 'stats-room', open: '' },
		el('summary', {}, el('h2', {}, 'This room'), summaryNote),
		body,
	));
	// Open/closed as last set here; a toggle that doesn't match it was the user's click.
	// (toggle fires late, and also once for the initial open, so a flag around setOpen can't tell.)
	let autoOpen = true;
	details.addEventListener('toggle', () => { if (details.open !== autoOpen) userToggled = true; });
	const setOpen = (/** @type {boolean} */ open) => { autoOpen = open; details.open = open; };

	/** The room list as teams: [{mmr, names}] in seed order; null if it has no MMRs (e.g. typed by hand). */
	const teams = () => {
		const bySeed = new Map();
		for (const p of mogi.roster) {
			if (!bySeed.has(p.seed)) bySeed.set(p.seed, { mmr: p.mmr, names: [] });
			bySeed.get(p.seed).names.push(p.name);
		}
		const list = [...bySeed.values()];
		return list.length >= 2 && list.every(t => t.mmr > 0) ? list : null;
	};

	const load = async (/** @type {string} */ key, /** @type {any[]} */ t, /** @type {string|null} */ self) => {
		loadingKey = key;
		try {
			const res = await fetchRoom(t, self, statsSettings.selfPlayerId);
			if (loadingKey !== key) return;
			room = res; error = ''; loadedKey = key;
		} catch (e) {
			if (loadingKey !== key) return;
			console.warn('Could not load the room preview', e);
			room = null; error = 'Could not load the room preview from the stats server.'; loadedKey = key;
		} finally {
			if (loadingKey === key) loadingKey = '';
			render();
		}
	};

	/** Where you stand right now (1-based), from the scores so far; null before race 1. */
	const placeNow = () => {
		const p = me();
		if (!p || !mogi.size) return null;
		const scores = mogi.calculatePlayerScores();
		const players = [...mogi.roster];
		const total = (/** @type {number} */ seed) => players.filter(x => x.seed === seed).reduce((a, x) => a + (scores.get(x.id) ?? 0), 0);
		const seeds = [...new Set(players.map(x => x.seed))];
		const mine = total(p.seed);
		return 1 + seeds.filter(s => s !== p.seed && total(s) > mine).length;
	};

	/** @param {any} x */
	const h2h = x => `${x.vs.above}–${x.vs.below}${x.vs.ties ? `–${x.vs.ties}` : ''}`;

	/** @param {any} x @param {'good'|'bad'} kind @param {string} detail */
	const person = (x, kind, detail) => el('div', { class: `stats-person is-${kind}` },
		el('strong', {}, x.name), ' ', el('span', { class: 'stats-person-detail' }, detail));

	const render = () => {
		const t = teams();
		if (!t) {
			summaryNote.textContent = '';
			body.replaceChildren(el('p', { class: 'muted' }, 'The room list has no MMRs, so there is nothing to work out.'));
			return;
		}
		if (error) { body.replaceChildren(el('p', { class: 'stats-error' }, error)); return; }
		if (!room) { body.replaceChildren(el('p', { class: 'muted' }, 'Loading…')); return; }

		const s = room.self;
		summaryNote.textContent = s ? ` · ${nf.format(Math.round(s.mmr))} MMR${room.format === 'FFA' ? '' : ' (team)'} vs room average ${nf.format(room.roomAvg)} (${signed(s.vsRoom)})` : '';
		const parts = [];

		if (!s) {
			parts.push(el('p', { class: 'muted' }, 'Choose which player you are (under Next track) to see what each place is worth.'));
		} else {
			const now = mogi.ended ? null : placeNow();
			const final = mogi.ended ? placeNow() : null;
			parts.push(el('div', { class: 'stats-places', role: 'list', 'aria-label': 'MMR change for each finishing place' },
				...s.places.map((/** @type {number} */ d, /** @type {number} */ i) => {
					const n = i + 1;
					const marks = [n === s.seedPlace ? 'by MMR' : '', n === now ? 'now' : '', n === final ? 'final' : ''].filter(Boolean);
					return el('div', {
						role: 'listitem',
						class: `stats-place ${d > 0 ? 'is-gain' : d < 0 ? 'is-loss' : ''}${n === s.seedPlace ? ' is-seed' : ''}${n === now || n === final ? ' is-now' : ''}`,
						title: `Finish ${place(n)}: ${signed(d)} MMR${marks.length ? ` (${marks.join(', ')})` : ''}`,
					}, el('small', {}, place(n)), el('strong', {}, signed(d)), marks.length ? el('small', { class: 'stats-place-mark' }, marks.join(' · ')) : '');
				})));
			const line = [
				s.breakEven ? `You gain MMR down to ${place(s.breakEven)}.` : 'Every place loses MMR.',
				`If the room finished in MMR order you'd be ${place(s.seedPlace)} (${signed(s.places[s.seedPlace - 1])}).`,
			];
			if (now) line.push(`Right now you're ${place(now)}: ${signed(s.places[now - 1])} if it ended here.`);
			if (final) line.push(`You finished ${place(final)}: about ${signed(s.places[final - 1])}.`);
			parts.push(el('p', { class: 'muted small' }, line.join(' ')));
		}

		/** @type {any[]} */ const players = room.players;
		const mates = players.filter(x => x.teammate);
		const beatsYou = players.filter(x => x.tag === 'beats-you').sort((a, b) => a.vs.lean - b.vs.lean);
		const youBeat = players.filter(x => x.tag === 'you-beat').sort((a, b) => b.vs.lean - a.vs.lean);
		const others = players.filter(x => !x.teammate && !x.tag && x.vs).sort((a, b) => b.vs.met - a.vs.met);

		const groups = [];
		if (mates.length) {
			groups.push(el('div', { class: 'stats-people' }, el('span', { class: 'stats-people-label' }, mates.length > 1 ? 'Teammates' : 'Teammate'),
				...mates.map(x => {
					const tg = x.together;
					const kind = x.tag === 'good-teammate' ? 'good' : x.tag === 'bad-teammate' ? 'bad' : 'plain';
					const detail = tg
						? `${tg.mogis} mogi${tg.mogis === 1 ? '' : 's'} together: ${signed(tg.net)} MMR (${signed(tg.vsUsual)} a mogi vs your usual)`
						: 'first time on a team together';
					const vsNote = x.vs ? ` · as opponents ${h2h(x)}` : '';
					return person(x, /** @type {any} */(kind), detail + vsNote);
				})));
		}
		/** @param {any} x */
		const vsDetail = x => `${h2h(x)} in ${x.vs.met} mogi${x.vs.met === 1 ? '' : 's'} · ${signed(x.vs.roomNet)} MMR in those rooms`;
		if (beatsYou.length) groups.push(el('div', { class: 'stats-people' }, el('span', { class: 'stats-people-label' }, 'Usually above you'), ...beatsYou.map(x => person(x, 'bad', vsDetail(x)))));
		if (youBeat.length) groups.push(el('div', { class: 'stats-people' }, el('span', { class: 'stats-people-label' }, 'Usually below you'), ...youBeat.map(x => person(x, 'good', vsDetail(x)))));
		if (others.length) {
			const shown = others.slice(0, OTHERS_SHOWN).map(x => `${x.name} (${h2h(x)})`).join(', ');
			groups.push(el('p', { class: 'muted small' }, `Also met before: ${shown}${others.length > OTHERS_SHOWN ? ` and ${others.length - OTHERS_SHOWN} more` : ''}.`));
		}
		if (!groups.length) groups.push(el('p', { class: 'muted small' }, 'You haven\'t met anyone in this room before.'));
		else groups.unshift(el('p', { class: 'muted small' }, 'Head-to-head is who scored more when you were in the same room (you–them).'));
		body.replaceChildren(...parts, ...groups);
	};

	const refresh = () => {
		const started = mogi.size > 0;
		if (!userToggled && started !== wasStarted) setOpen(!started);
		wasStarted = started;
		const t = teams();
		const self = me()?.name ?? null;
		const key = JSON.stringify([t, self, statsSettings.serverUrl, statsSettings.selfPlayerId]);
		if (t && key !== loadedKey && key !== loadingKey) load(key, t, self);
		render();
	};

	return { element: details, refresh };
}
