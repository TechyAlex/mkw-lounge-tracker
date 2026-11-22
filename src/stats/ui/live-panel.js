// Live stats panel, shown under the scoreboard while linked to a stats server:
// - Next track: where you start the next race (= where you just finished) and the server's
//   "Pick a track for your start position" ranking for it: tracks to pick, and to avoid.
// - Tracks: each race's recognised track. The best guess is used as is; one click swaps to
//   guess 2 or 3, or type any other abbreviation.

/**
 * @typedef {import("../session.js").StatsSession} StatsSession
 * @typedef {import("../auto-tracks.js").TrackRecognizer} TrackRecognizer
 * @typedef {import("../tracks.js").TrackList} TrackList
 * @typedef {import("../../race.js").Race} Race
 */

import { fmt } from '../../i18n/i18n.js';
import { fetchStartPicks } from '../api.js';
import { RECOGNIZER_STATUS_EVENT } from '../auto-tracks.js';
import { LABELS_CHANGED_EVENT } from '../session.js';
import { statsSettings } from '../settings.js';
import { loadTracks, splitLabel, trackLabel, UNKNOWN_ABBR } from '../tracks.js';
import { el } from './dom.js';
import { pickSelf } from './self-picker.js';

const PICKS_SHOWN = 5;
const AVOID_SHOWN = 3;

/** @param {number|null|undefined} x */
const signed = x => x == null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(1)}`;
/** @param {number|null|undefined} x */
const dec = x => x == null ? '—' : x.toFixed(1);
/** @param {number} n */
const place = n => fmt.place(n).trim();

/**
 * @param {StatsSession} session
 * @param {TrackRecognizer} recognizer
 * @returns {{ refresh: () => void, reloadPicks: () => void, element: HTMLElement }}
 */
export function createLivePanel(session, recognizer) {
	const mogi = session.mogi;
	/** @type {TrackList|null} */ let tracks = null;
	/** @type {any} */ let startPicks = null;
	let startPicksError = '';
	let startPicksLoading = false;

	const nextBody = el('div', { class: 'stats-next' });
	const status = el('span', { class: 'muted stats-live-status', 'aria-live': 'polite' });
	const list = el('ol', { class: 'stats-live-races' });
	const datalist = el('datalist', { id: 'stats-live-tracklist' });
	const section = el('section', { class: 'panel stats-live' },
		el('h2', {}, 'Next track'),
		nextBody,
		el('div', { class: 'row stats-live-head' }, el('h2', {}, 'Tracks'), status),
		list,
		datalist,
	);

	/** The user's roster player: the one chosen this mogi, else the remembered name if it's in the roster. */
	const me = () => session.selfPlayer ?? [...mogi.roster].find(p => p.name === statsSettings.selfName) ?? null;

	/** @param {Race} race */
	const myPlacement = race => {
		const p = me();
		const row = p ? race.placements.find(r => r.playerId === p.id) : null;
		return row ? { placement: row.placement, dc: row.dc } : null;
	};

	const loadStartPicks = async () => {
		if (startPicksLoading) return;
		startPicksLoading = true;
		try {
			startPicks = await fetchStartPicks(statsSettings.selfPlayerId);
			startPicksError = '';
		} catch (e) {
			console.warn('Could not load start-position picks', e);
			startPicksError = 'Could not load start-position picks from the stats server.';
		} finally {
			startPicksLoading = false;
			renderNext();
		}
	};

	const renderNext = () => {
		const races = session.races;
		const p = me();
		const who = p
			? el('span', { class: 'muted' }, ` as ${p.name} `)
			: null;
		const change = el('button', { type: 'button', class: 'stats-link' }, p ? 'change' : 'Which player are you?');
		change.addEventListener('click', async () => {
			const name = await pickSelf(mogi, session.selfName);
			if (name) { session.selfName = name; renderNext(); }
		});

		if (!p) return nextBody.replaceChildren(el('p', {}, 'To suggest a track for your start position, ', change));
		if (mogi.ended) return nextBody.replaceChildren(el('p', { class: 'muted' }, 'Mogi finished.'));
		const last = races.at(-1);
		if (!last) return nextBody.replaceChildren(el('p', { class: 'muted' }, 'After each race, this shows which tracks you do best on from where you start the next one.', who, change));
		const mine = myPlacement(last);
		if (!mine || mine.dc || !mine.placement) {
			return nextBody.replaceChildren(el('p', { class: 'muted' }, `Couldn't find your placement in race ${races.length}.`, who, change));
		}
		const start = mine.placement;
		const intro = el('p', {},
			`You finished ${place(start)} in race ${races.length}, so you start ${place(start)} in race ${races.length + 1}.`, who, change);
		if (startPicksError) return nextBody.replaceChildren(intro, el('p', { class: 'stats-error' }, startPicksError));
		if (!startPicks) return nextBody.replaceChildren(intro, el('p', { class: 'muted' }, 'Loading picks…'));
		if (!startPicks.races) return nextBody.replaceChildren(intro, el('p', { class: 'muted' }, 'No matched races with track labels on the server yet.'));

		const st = startPicks.byStart?.[start - 1];
		const listForStart = /** @type {any[]} */(startPicks.picks?.[start] ?? []);
		const played = new Set(races.map(r => splitLabel(session.labelOf(r) ?? UNKNOWN_ABBR).abbr));
		// Picks skip tracks already raced this mogi (the next best fill in); Avoid keeps them.
		const best = listForStart.filter(t => t.edge > 0 && !played.has(t.abbr)).slice(0, PICKS_SHOWN);
		const worst = listForStart.filter(t => t.edge < 0).slice(-AVOID_SHOWN).reverse();

		/** @param {any} t @param {'good'|'bad'} kind */
		const card = (t, kind) => el('div', {
			class: `stats-pick is-${kind}${t.n < 3 ? ' is-thin' : ''}`,
			title: `${t.name}: ${signed(t.edge)} pts vs your usual from here · ${dec(t.avgPoints)} pts · finish ${dec(t.avgFinish)} · ${t.n} races${t.n < 3 ? ' (few races)' : ''}`,
		},
			el('strong', { class: 'mono' }, t.abbr), ' ',
			el('span', { class: 'stats-pick-name' }, t.name),
			el('span', { class: 'stats-pick-edge' }, signed(t.edge)),
			el('small', { class: 'muted' }, `n ${t.n}`),
			played.has(t.abbr) ? el('small', { class: 'stats-pick-played' }, 'played') : null,
		);
		nextBody.replaceChildren(
			intro,
			el('p', { class: 'muted small' }, st ? `From ${place(start)} you usually score ${dec(st.baseline)} pts. Points above that, on races that started within one place:` : ''),
			el('div', { class: 'stats-picks' }, el('span', { class: 'stats-picks-label' }, 'Pick'),
				...(best.length ? best.map(t => card(t, 'good')) : [el('span', { class: 'muted' }, played.size && listForStart.some(t => t.edge > 0) ? 'Every track that beats your usual from here has been played this mogi.' : 'No track beats your usual from here yet.')])),
			...(worst.length ? [el('div', { class: 'stats-picks' }, el('span', { class: 'stats-picks-label' }, 'Avoid'), ...worst.map(t => card(t, 'bad')))] : []),
		);
	};

	/** @param {Race} race @param {string} label */
	const choose = (race, label) => {
		session.setLabel(race, label);
		recognizer.update(); // re-rank the other races with this track taken
	};

	const renderRaces = () => {
		const races = session.races;
		status.textContent = recognizer.message;
		status.classList.toggle('stats-error', recognizer.status === 'error');
		if (!races.length) {
			list.replaceChildren(el('li', { class: 'muted stats-live-empty' }, 'Each race\'s track is recognised from its results screen as you capture it.'));
			return;
		}
		// Re-rendering mid-typing (a race finished recognising) keeps what you were typing.
		const focused = /** @type {HTMLInputElement|null} */(document.activeElement);
		const focusedIdx = focused?.dataset?.statsRace;
		const typing = focusedIdx != null ? focused?.value ?? '' : '';
		list.replaceChildren(...races.map((race, i) => {
			const label = session.labelOf(race);
			const guesses = session.guessesOf(race);
			const auto = session.isAutoLabel(race);
			const working = recognizer.isWorking(race.timestamp);
			const describe = (/** @type {string} */ l) => tracks?.describeLabel(l) ?? l;

			const current = label
				? el('span', { class: 'stats-live-track', title: describe(label) },
					el('strong', { class: 'mono' }, label), ' ', el('span', {}, describe(label)),
					el('span', { class: `stats-tag${auto ? '' : ' is-manual'}` }, auto ? 'auto' : 'set'))
				: el('span', { class: 'muted stats-live-track' }, working ? 'Recognising…' : recognizer.status === 'ready' ? 'Not recognised' : '—');

			const swaps = guesses.map((g, gi) => {
				const t = tracks?.byAbbr(g);
				const b = el('button', {
					type: 'button', class: `stats-guess${g === label ? ' is-on' : ''}`,
					title: `Guess ${gi + 1}: ${t ? trackLabel(t) : g}`, 'aria-pressed': String(g === label),
				}, el('small', { class: 'muted' }, `${gi + 1}`), ' ', g);
				b.addEventListener('click', () => choose(race, g));
				return b;
			});

			const input = el('input', {
				type: 'text', list: 'stats-live-tracklist', placeholder: 'Other…', size: '7', autocomplete: 'off',
				spellcheck: 'false', autocapitalize: 'characters', 'aria-label': `Race ${i + 1} track`, 'data-stats-race': String(i),
			});
			const apply = () => {
				const v = input.value.trim();
				if (!v) return;
				const resolved = tracks?.resolveLabel(v) ?? null;
				if (!resolved) {
					input.classList.add('stats-error');
					input.title = `“${v.toUpperCase()}” isn't a known track abbreviation (? = unknown, FROM>TO = connecting).`;
					return;
				}
				input.value = '';
				choose(race, resolved);
			};
			input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } if (e.key === 'Escape') input.value = ''; });
			input.addEventListener('change', apply);
			input.addEventListener('input', () => { input.classList.remove('stats-error'); input.title = ''; });

			const thumb = el('img', { src: race.snapshotUrl, alt: `Race ${i + 1} results`, loading: 'lazy' });
			return el('li', { class: `stats-live-race${auto ? ' is-auto' : ''}` },
				el('span', { class: 'mono muted stats-live-num' }, `R${i + 1}`),
				el('a', { href: race.snapshotUrl, target: '_blank', rel: 'noreferrer', class: 'stats-live-thumb' }, thumb),
				current,
				el('span', { class: 'row stats-live-swaps' }, ...swaps, input),
			);
		}));
		if (focusedIdx != null) {
			const again = /** @type {HTMLInputElement|null} */(list.querySelector(`[data-stats-race="${focusedIdx}"]`));
			if (again) { again.value = typing; again.focus(); }
		}
	};

	const refresh = () => {
		section.hidden = !statsSettings.liveEnabled;
		if (section.hidden) return;
		if (!startPicks && !startPicksError) loadStartPicks();
		renderNext();
		renderRaces();
	};

	loadTracks().then(t => {
		tracks = t;
		datalist.replaceChildren(...t.tracks.map(x => el('option', { value: x.abbr }, trackLabel(x))));
		renderRaces();
	});

	session.addEventListener(LABELS_CHANGED_EVENT, () => { if (!section.hidden) { renderRaces(); renderNext(); } });
	recognizer.addEventListener(RECOGNIZER_STATUS_EVENT, () => { if (!section.hidden) renderRaces(); });

	return {
		element: section,
		refresh,
		/** Reload the picks (e.g. after the server settings changed). */
		reloadPicks: () => { startPicks = null; startPicksError = ''; refresh(); },
	};
}
