import { ping } from '../api.js';
import { clearOutbox, flushOutbox, listOutbox } from '../outbox.js';
import { downloadJson } from '../session.js';
import { normalizeServerUrl, notifySettingsChanged, statsSettings } from '../settings.js';
import { refreshTracksFromServer } from '../tracks.js';
import { success } from '../../ui/toast.js';
import { el } from './dom.js';

/** Open the "Stats server" settings panel. */
export function openStatsSettings() {
	const url = el('input', { type: 'url', placeholder: 'https://stats.example.com', autocomplete: 'off', spellcheck: 'false' });
	url.value = statsSettings.serverUrl;
	const token = el('input', { type: 'password', autocomplete: 'off', spellcheck: 'false' });
	token.value = statsSettings.token;
	const toggleToken = el('button', { type: 'button', 'aria-label': 'Show token' }, 'Show');
	const playerId = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'optional', autocomplete: 'off' });
	playerId.value = statsSettings.selfPlayerId === null ? '' : String(statsSettings.selfPlayerId);
	const labeling = el('input', { type: 'checkbox' });
	labeling.checked = statsSettings.labelingEnabled;
	const labelingHint = el('span', { class: 'muted' });
	const testBtn = el('button', { type: 'button' }, 'Test connection');
	const testOut = el('p', { class: 'muted stats-test-output' });
	const errorOut = el('p', { class: 'stats-error', hidden: true });
	const outboxOut = el('div', { class: 'stats-outbox' });
	const save = el('button', { type: 'submit', class: 'btn--primary' }, 'Save');
	const cancel = el('button', { type: 'button' }, 'Cancel');

	const updateLabelingHint = () => {
		labelingHint.textContent = statsSettings.labelingSetting
			? ''
			: '(default: on when a stats server is set)';
	};
	updateLabelingHint();
	// Until the user touches the checkbox (and has no explicit choice saved), it follows the default:
	// on when a server URL is entered, off otherwise.
	let labelingTouched = statsSettings.labelingSetting !== '';
	labeling.addEventListener('change', () => { labelingTouched = true; labelingHint.textContent = ''; });
	url.addEventListener('input', () => { if (!labelingTouched) labeling.checked = url.value.trim() !== ''; });

	toggleToken.addEventListener('click', () => {
		const show = token.type === 'password';
		token.type = show ? 'text' : 'password';
		toggleToken.textContent = show ? 'Hide' : 'Show';
		toggleToken.setAttribute('aria-label', show ? 'Hide token' : 'Show token');
	});

	testBtn.addEventListener('click', async () => {
		const norm = normalizeServerUrl(url.value);
		if (!norm.ok) { testOut.textContent = norm.error; return; }
		if (!norm.url) { testOut.textContent = 'Enter a server URL first.'; return; }
		testBtn.disabled = true;
		testOut.textContent = 'Testing…';
		const res = await ping(norm.url, token.value.trim());
		let msg = res.message;
		try {
			const tracks = await refreshTracksFromServer(norm.url);
			msg += ` · ${tracks.length} tracks loaded`;
		} catch {
			msg += ' · could not load /api/tracks';
		}
		testOut.textContent = msg;
		testBtn.disabled = false;
	});

	const renderOutbox = async () => {
		const entries = await listOutbox();
		outboxOut.replaceChildren();
		if (!entries.length) return;
		const rejected = entries.filter(e => e.needsAttention).length;
		const retry = el('button', { type: 'button' }, 'Retry now');
		const dl = el('button', { type: 'button' }, 'Download all');
		const clear = el('button', { type: 'button', class: 'btn--danger' }, 'Discard');
		retry.addEventListener('click', async () => {
			retry.disabled = true;
			const r = await flushOutbox({ includeRejected: true });
			if (r.sent) success(`Sent ${r.sent} queued mogi${r.sent === 1 ? '' : 's'}`);
			await renderOutbox();
		});
		dl.addEventListener('click', () => entries.forEach(e => downloadJson(e.payload, e.fileName)));
		clear.addEventListener('click', async () => {
			if (!confirm(`Discard ${entries.length} queued upload(s)? Download them first if you still need them.`)) return;
			await clearOutbox();
			await renderOutbox();
		});
		outboxOut.append(
			el('p', {}, `Outbox: ${entries.length} mogi${entries.length === 1 ? '' : 's'} waiting to be sent`
				+ (rejected ? ` (${rejected} rejected by the server)` : '') + '.'),
			el('p', { class: 'muted' }, entries.map(e => e.lastError).filter(Boolean).slice(0, 3).join(' · ')),
			el('div', { class: 'row' }, retry, dl, clear),
		);
	};
	renderOutbox();

	const form = el('form', { method: 'dialog', class: 'modal stats-modal stats-settings' },
		el('h3', {}, '📊 Stats server'),
		el('p', { class: 'muted' },
			'Optional. Send each finished mogi (roster, results and track labels — no screenshots) to your own MKW Advanced Stats server. '
			+ 'These settings are stored only in this browser. Leave the URL empty to turn sending off.'),
		el('label', { class: 'stats-field' }, el('span', {}, 'Server URL'), url),
		el('label', { class: 'stats-field' }, el('span', {}, 'Upload token'), el('span', { class: 'row stats-inline' }, token, toggleToken)),
		el('label', { class: 'stats-field' }, el('span', {}, 'Your Lounge player ID'), playerId),
		el('label', { class: 'stats-check' }, labeling, el('span', {}, 'Label tracks after each mogi'), labelingHint),
		el('div', { class: 'row' }, testBtn),
		testOut,
		outboxOut,
		errorOut,
		el('footer', {}, cancel, save),
	);
	const dialog = el('dialog', {}, form);
	document.body.append(dialog);

	form.addEventListener('submit', e => {
		const norm = normalizeServerUrl(url.value);
		const pid = playerId.value.trim();
		/** @type {string[]} */
		const errors = [];
		if (!norm.ok) errors.push(norm.error);
		if (pid && !/^\d+$/.test(pid)) errors.push('Player ID must be a number.');
		if (norm.ok && norm.url && !token.value.trim()) errors.push('Enter the upload token (or clear the server URL).');
		if (errors.length || !norm.ok) {
			e.preventDefault();
			errorOut.hidden = false;
			errorOut.textContent = errors.join(' ');
			return;
		}
		const serverChanged = norm.url !== statsSettings.serverUrl;
		statsSettings.serverUrl = norm.url;
		statsSettings.token = token.value.trim();
		statsSettings.selfPlayerId = pid ? Number(pid) : null;
		// Only store an explicit labeling choice once the user has made one.
		if (labelingTouched) statsSettings.labelingSetting = labeling.checked ? 'on' : 'off';
		if (serverChanged) statsSettings.tracksCache = '';
		notifySettingsChanged();
		success('Stats settings saved');
		if (statsSettings.serverConfigured) flushOutbox({ includeRejected: true });
	});
	cancel.addEventListener('click', () => dialog.close());
	dialog.addEventListener('close', () => dialog.remove());
	dialog.showModal();
	url.focus();
}
