/**
 * @typedef {import("../session.js").StatsSession} StatsSession
 * @typedef {import("../tracks.js").TrackList} TrackList
 * @typedef {import("../tracks.js").Track} Track
 */

import { fmt } from '../../i18n/i18n.js';
import { CONNECTING_SEPARATOR, trackLabel, UNKNOWN_ABBR } from '../tracks.js';
import { el } from './dom.js';

const PLACEHOLDER_IMG = 'data:image/svg+xml,' + encodeURIComponent(
	'<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="100%" height="100%" fill="#151515"/>'
	+ '<text x="50%" y="50%" fill="#666" font-family="sans-serif" font-size="40" text-anchor="middle">No screenshot for this race</text></svg>');

/**
 * Show each counted race's results screenshot, one at a time, and ask "What track is this?".
 * Labels are saved into the session as you go.
 * @param {StatsSession} session
 * @param {TrackList} tracks
 * @param {number} [startIndex] Race index to start at (default: first unlabeled race)
 * @returns {Promise<boolean>} true if the user went through to the end, false if closed early
 */
export function labelTracks(session, tracks, startIndex) {
	const races = session.races;
	if (!races.length) return Promise.resolve(true);
	let idx = startIndex ?? Math.max(0, races.findIndex(r => !session.labelOf(r)));
	if (idx < 0 || idx >= races.length) idx = 0;

	return new Promise(resolve => {
		const title = el('h3', {});
		const context = el('span', { class: 'muted' });
		const progress = el('div', { class: 'stats-progress' });
		const img = el('img', { alt: '' });
		img.addEventListener('error', () => { if (img.src !== PLACEHOLDER_IMG) img.src = PLACEHOLDER_IMG; });
		const input = el('input', {
			type: 'text', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'characters',
			'aria-label': 'Track abbreviation', placeholder: 'e.g. BC — or ? if unsure',
			role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': 'stats-track-suggestions',
		});
		const resolved = el('div', { class: 'stats-resolved', 'aria-live': 'polite' });
		const guessRow = el('div', { class: 'row stats-guesses' });
		const suggestions = el('ul', { class: 'stats-suggestions', id: 'stats-track-suggestions', role: 'listbox' });
		const back = el('button', { type: 'button' }, '← Back');
		const skip = el('button', { type: 'button' }, 'Unknown (?)');
		const connecting = el('button', { type: 'button', title: 'Mark as a connecting track: FROM>TO, e.g. MBC>CC' }, '↪ Connecting');
		const next = el('button', { type: 'button', class: 'btn--primary' }, 'Next →');
		const close = el('button', { type: 'button' }, 'Close');

		const form = el('form', { method: 'dialog', class: 'modal stats-modal stats-labeler' },
			el('div', { class: 'row stats-labeler-head' }, title, context, el('ins', { class: 'spacer' }), progress),
			el('div', { class: 'stats-shot' }, img),
			el('label', { class: 'stats-track-input' }, el('span', {}, 'What track is this?'), input),
			guessRow,
			resolved,
			suggestions,
			el('p', { class: 'muted stats-hint' },
				'Enter = accept & next · Alt+1/2/3 = recognised guess · Shift+Enter = back · ↑/↓ = pick a suggestion · Tab = complete · ? = unknown · FROM>TO = connecting track (e.g. MBC>CC) · Esc = close'),
			el('footer', {}, close, el('ins', { class: 'spacer' }), back, connecting, skip, next),
		);
		const dialog = el('dialog', { class: 'stats-labeler-dialog' }, form);
		document.body.append(dialog);

		/** For a connecting route being typed ("MBC>C"), suggestions apply to the part after ">". */
		const segments = () => {
			const value = input.value;
			const i = value.lastIndexOf(CONNECTING_SEPARATOR);
			return i < 0 ? { prefix: '', segment: value } : { prefix: value.slice(0, i + 1).trim(), segment: value.slice(i + 1) };
		};

		/** @type {Track[]} */ let currentSuggestions = [];
		let highlighted = -1;
		let finished = false;

		const renderProgress = () => {
			progress.replaceChildren(...races.map((r, i) => {
				const abbr = session.labelOf(r);
				const chip = el('button', {
					type: 'button', class: `stats-chip${i === idx ? ' is-current' : ''}${abbr ? ' is-done' : ''}`,
					title: `Race ${i + 1}${abbr ? `: ${abbr}` : ''}`, tabindex: '-1',
				}, abbr ?? String(i + 1));
				chip.addEventListener('click', () => go(i));
				return chip;
			}));
		};

		const renderSuggestions = () => {
			suggestions.replaceChildren(...currentSuggestions.map((t, i) => {
				const li = el('li', { role: 'option', class: i === highlighted ? 'is-active' : '', 'aria-selected': String(i === highlighted) },
					el('strong', { class: 'mono' }, t.abbr), ' ', el('span', {}, trackLabel(t)));
				li.addEventListener('mousedown', e => { e.preventDefault(); acceptCandidate(segments().prefix + t.abbr); });
				return li;
			}));
			input.setAttribute('aria-expanded', String(currentSuggestions.length > 0));
		};

		/** @param {boolean} [showError] */
		const update = (showError = false) => {
			const value = input.value.trim();
			resolved.classList.remove('stats-error');
			if (!value) {
				resolved.textContent = '';
				currentSuggestions = [];
			} else if (value === UNKNOWN_ABBR) {
				resolved.textContent = 'Unknown — this race is left out of track stats.';
				currentSuggestions = [];
			} else {
				const { segment } = segments();
				const label = tracks.resolveLabel(value);
				const segMatch = tracks.resolve(segment);
				currentSuggestions = tracks.suggest(segment).filter(t => t !== segMatch);
				if (label) {
					const t = tracks.byAbbr(label);
					resolved.textContent = `✓ ${t ? `${t.abbr} — ${trackLabel(t)}` : `${label} — ${tracks.describeLabel(label)}`}`;
				} else if (showError) {
					resolved.classList.add('stats-error');
					const bad = value.split(CONNECTING_SEPARATOR).map(x => x.trim()).filter(x => x !== UNKNOWN_ABBR && !tracks.resolve(x));
					resolved.textContent = `“${(bad.join(', ') || value).toUpperCase()}” isn't a known track abbreviation. `
						+ (currentSuggestions.length ? 'Did you mean one of these? ' : '')
						+ 'Or type ? to mark it unknown.';
				} else if (value.includes(CONNECTING_SEPARATOR) && !segment.trim()) {
					resolved.textContent = 'Connecting track — now type where it goes to.';
				} else {
					resolved.textContent = currentSuggestions.length ? '' : 'No matching track.';
				}
			}
			if (highlighted >= currentSuggestions.length) highlighted = -1;
			renderSuggestions();
		};

		/** @param {number} i */
		const go = i => {
			idx = i;
			const race = races[idx];
			title.textContent = `Race ${idx + 1} of ${races.length}`;
			const me = session.selfResult(race);
			context.textContent = me
				? `You: ${me.dc ? 'DC' : fmt.place(me.placement).trim()} · +${me.points} pts`
				: '';
			img.src = race.snapshotUrl || PLACEHOLDER_IMG;
			img.alt = `Race ${idx + 1} results screen`;
			input.value = session.labelOf(race) ?? '';
			const guesses = session.guessesOf(race);
			guessRow.replaceChildren(...(guesses.length ? [el('span', { class: 'muted' }, session.isAutoLabel(race) ? 'Recognised:' : 'Guesses:')] : []),
				...guesses.map((g, gi) => {
					const t = tracks.byAbbr(g);
					const b = el('button', { type: 'button', class: `stats-guess${g === input.value ? ' is-on' : ''}`, tabindex: '-1', title: `Alt+${gi + 1}` },
						el('small', { class: 'muted' }, String(gi + 1)), ' ', el('strong', { class: 'mono' }, g), ' ', t ? trackLabel(t) : '');
					b.addEventListener('click', () => accept(g));
					return b;
				}));
			highlighted = -1;
			next.textContent = idx === races.length - 1 ? 'Finish ✓' : 'Next →';
			back.disabled = idx === 0;
			renderProgress();
			update();
			input.focus();
			input.select();
		};

		/** @param {string} abbr */
		const accept = abbr => {
			session.setLabel(races[idx], abbr);
			if (idx < races.length - 1) go(idx + 1);
			else { finished = true; dialog.close(); }
		};

		/** @param {string} candidate */
		const acceptCandidate = candidate => {
			const label = tracks.resolveLabel(candidate);
			if (label) return accept(label);
			input.value = candidate;
			highlighted = -1;
			update(true);
			input.focus();
		};

		const tryAccept = () => {
			const value = input.value.trim();
			if (highlighted >= 0 && currentSuggestions[highlighted]) return acceptCandidate(segments().prefix + currentSuggestions[highlighted].abbr);
			const label = value ? tracks.resolveLabel(value) : null;
			if (label) return accept(label);
			if (!value) {
				resolved.classList.add('stats-error');
				resolved.textContent = 'Type the track abbreviation, or ? if you don\'t know it.';
				return;
			}
			update(true);
			input.select(); // retyping replaces the rejected code
		};

		input.addEventListener('input', () => { highlighted = -1; update(); });
		input.addEventListener('keydown', e => {
			const guessKey = e.altKey && /^Digit[1-3]$/.test(e.code) ? Number(e.code.slice(5)) - 1 : -1;
			if (guessKey >= 0) {
				e.preventDefault();
				const g = session.guessesOf(races[idx])[guessKey];
				if (g) accept(g);
			} else if (e.key === 'Enter') {
				e.preventDefault();
				if (e.shiftKey) { if (idx > 0) go(idx - 1); }
				else tryAccept();
			} else if (e.key === 'ArrowDown' && currentSuggestions.length) {
				e.preventDefault();
				highlighted = (highlighted + 1) % currentSuggestions.length;
				renderSuggestions();
			} else if (e.key === 'ArrowUp' && currentSuggestions.length) {
				e.preventDefault();
				highlighted = highlighted <= 0 ? currentSuggestions.length - 1 : highlighted - 1;
				renderSuggestions();
			} else if (e.key === 'Tab' && !e.shiftKey && currentSuggestions.length && !tracks.resolveLabel(input.value)) {
				e.preventDefault();
				input.value = segments().prefix + currentSuggestions[Math.max(0, highlighted)].abbr;
				highlighted = -1;
				update();
			}
		});
		form.addEventListener('submit', e => e.preventDefault());
		back.addEventListener('click', () => { if (idx > 0) go(idx - 1); });
		skip.addEventListener('click', () => accept(UNKNOWN_ABBR));
		connecting.addEventListener('click', () => {
			if (!input.value.includes(CONNECTING_SEPARATOR)) input.value = input.value.trim() + CONNECTING_SEPARATOR;
			input.focus();
			highlighted = -1;
			update();
		});
		next.addEventListener('click', tryAccept);
		close.addEventListener('click', () => dialog.close());
		dialog.addEventListener('close', () => { dialog.remove(); resolve(finished); });

		dialog.showModal();
		go(idx);
	});
}
