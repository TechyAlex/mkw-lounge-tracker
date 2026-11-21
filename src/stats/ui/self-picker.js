/** @typedef {import("../../mogi.js").Mogi} Mogi */

import { statsSettings } from '../settings.js';
import { el } from './dom.js';

/**
 * "Which player am I?" — pick yourself from the roster.
 * Preselects the remembered name if it's in this roster; otherwise the user must choose.
 * @param {Mogi} mogi
 * @param {string|null} [current]
 * @returns {Promise<string|null>} Chosen Lounge name, or null if cancelled
 */
export function pickSelf(mogi, current = null) {
	const players = [...mogi.roster];
	const remembered = current ?? statsSettings.selfName;
	const preselect = players.find(p => p.name === remembered)?.name ?? null;

	return new Promise(resolve => {
		const list = el('div', { class: 'stats-self-list', role: 'radiogroup' });
		players.forEach((p, i) => {
			const team = mogi.playersPerTeam > 1 ? mogi.teamBySeed(p.seed) : null;
			const input = el('input', { type: 'radio', name: 'stats-self', value: p.name });
			if (p.name === preselect) input.checked = true;
			const label = el('label', {},
				input,
				el('span', { class: 'mono muted' }, String(i + 1).padStart(2, ' ') + '.'),
				el('span', {}, p.name),
			);
			if (team) label.style.background = `${team.colour}30`;
			list.append(label);
		});
		const hint = el('p', { class: 'muted' }, preselect
			? 'Remembered from last time — press Enter to confirm.'
			: remembered
				? `“${remembered}” isn't in this roster. Pick yourself:`
				: 'Pick yourself from the roster. This is remembered for next time.');
		const confirm = el('button', { type: 'submit', class: 'btn--primary' }, 'Confirm');
		const cancel = el('button', { type: 'button', value: 'cancel' }, 'Cancel');
		const form = el('form', { method: 'dialog', class: 'modal stats-modal' },
			el('h3', {}, 'Which player are you?'),
			hint,
			list,
			el('footer', {}, cancel, confirm),
		);
		const dialog = el('dialog', {}, form);
		document.body.append(dialog);

		let result = /** @type {string|null} */(null);
		form.addEventListener('submit', e => {
			const chosen = /** @type {HTMLInputElement|null} */(list.querySelector('input:checked'));
			if (!chosen) { e.preventDefault(); hint.textContent = 'Select your name first.'; hint.classList.add('stats-error'); return; }
			result = chosen.value;
			statsSettings.selfName = result;
		});
		cancel.addEventListener('click', () => dialog.close());
		dialog.addEventListener('close', () => { dialog.remove(); resolve(result); });
		dialog.showModal();
		/** @type {HTMLInputElement|null} */(list.querySelector('input:checked') ?? list.querySelector('input'))?.focus();
	});
}
