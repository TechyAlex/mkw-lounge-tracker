/**
 * @typedef {import("../session.js").StatsSession} StatsSession
 * @typedef {import("../api.js").SendResult} SendResult
 */

import { fmt } from '../../i18n/i18n.js';
import { describeStatus, getSessionStatus, postSession } from '../api.js';
import { enqueue, flushOutbox, removeFromOutbox } from '../outbox.js';
import { downloadJson } from '../session.js';
import { statsSettings } from '../settings.js';
import { loadTracks } from '../tracks.js';
import { el } from './dom.js';
import { pickSelf } from './self-picker.js';
import { labelTracks } from './track-labeler.js';
import { openStatsSettings } from './settings-dialog.js';

/**
 * Send the session to the stats server. Failures that might succeed later go to the outbox.
 * @param {StatsSession} session
 * @param {import("../tracks.js").TrackList} tracks
 * @returns {Promise<SendResult>}
 */
export async function sendSession(session, tracks) {
	const payload = session.buildPayload(tracks, statsSettings.selfPlayerId);
	const res = await postSession(payload);
	session.lastResult = res;
	if (res.kind === 'pending' || res.kind === 'linked') {
		session.sent = true;
		await removeFromOutbox(session.sessionId);
		flushOutbox(); // a good moment to deliver anything queued from earlier mogis
	} else if (res.kind === 'retry') {
		await enqueue(payload, session.fileName, res.message);
	} else {
		await removeFromOutbox(session.sessionId); // the user is fixing it here; don't retry a stale copy
	}
	return res;
}

/**
 * The full Finish flow, started from the Stats button: pick self → label tracks → summary
 * (sends automatically when a server is configured and this mogi hasn't been sent yet).
 * @param {StatsSession} session
 */
export async function runFinishFlow(session) {
	if (!session.selfPlayer) {
		const name = await pickSelf(session.mogi, session.selfName);
		if (!name) return;
		session.selfName = name;
	}
	const tracks = await loadTracks();
	let justLabeled = false;
	if (statsSettings.labelingEnabled && session.labeledCount < session.races.length) {
		const done = await labelTracks(session, tracks);
		if (!done) return;
		justLabeled = true;
	}
	await openSessionDialog(session, { autoSend: justLabeled || (!session.sent && !session.lastResult) });
}

/**
 * Summary of the mogi export, with send / download / relabel actions.
 * @param {StatsSession} session
 * @param {{autoSend?: boolean}} [opts]
 */
export async function openSessionDialog(session, opts = {}) {
	let tracks = await loadTracks();
	const server = statsSettings.serverConfigured;

	const selfLine = el('p', {});
	const table = el('table', { class: 'stats-races mono' });
	const status = el('p', { class: 'stats-status', 'aria-live': 'polite' });
	const statusActions = el('span', { class: 'row' });
	const labelBtn = el('button', { type: 'button' }, '🏷️ Label tracks');
	const downloadBtn = el('button', { type: 'button' }, '💾 Download session JSON');
	const sendBtn = el('button', { type: 'button', class: 'btn--primary' }, session.sent ? '📤 Re-send' : '📤 Send to stats server');
	const closeBtn = el('button', { type: 'button' }, 'Close');
	const changeSelf = el('button', { type: 'button', class: 'stats-link' }, 'change');

	const form = el('form', { method: 'dialog', class: 'modal stats-modal stats-session' },
		el('h3', {}, '📊 Mogi stats export'),
		selfLine,
		el('div', { class: 'stats-races-wrap' }, table),
		el('div', { class: 'row' }, status, statusActions),
		el('p', { class: 'muted' }, server
			? `Session ${session.sessionId.slice(0, 8)} · re-sending updates the same mogi on the server. Screenshots are never uploaded.`
			: 'No stats server configured — download the JSON and upload it on your stats site, or set up a server in 📊 settings.'),
		el('footer', {}, closeBtn, el('ins', { class: 'spacer' }), labelBtn, downloadBtn, server ? sendBtn : null),
	);
	const dialog = el('dialog', {}, form);
	document.body.append(dialog);

	const render = () => {
		selfLine.replaceChildren('You: ', el('strong', {}, session.selfName ?? '(not chosen)'), ' ', changeSelf);
		const me = session.selfPlayer;
		table.replaceChildren(
			el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Track'), el('th', {}, 'You'), el('th', {}, 'Pts'), el('th', {}, ''))),
			el('tbody', {}, ...session.races.map((race, i) => {
				const label = session.labelOf(race);
				const r = me ? session.selfResult(race) : null;
				const edit = el('button', { type: 'button', class: 'stats-link' }, 'edit');
				edit.addEventListener('click', async () => {
					dialog.close();
					await labelTracks(session, tracks, i);
					openSessionDialog(session);
				});
				return el('tr', {},
					el('td', {}, String(i + 1)),
					el('td', { class: label ? '' : 'muted' }, label ? `${label} · ${tracks.describeLabel(label)}` : '—',
						session.isAutoLabel(race) ? el('span', { class: 'stats-tag', title: 'Recognised automatically' }, 'auto') : null),
					el('td', {}, r ? (r.dc ? 'DC' : fmt.place(r.placement).trim()) : '—'),
					el('td', {}, r ? `+${r.points}` : '—'),
					el('td', {}, edit),
				);
			})),
		);
	};

	/** @param {SendResult|null} res */
	const showResult = res => {
		statusActions.replaceChildren();
		status.className = 'stats-status';
		if (!server) { status.textContent = ''; return; }
		if (!res) { status.textContent = session.sent ? 'Sent earlier.' : 'Not sent yet.'; return; }
		status.textContent = res.message;
		if (res.kind === 'pending' || res.kind === 'linked') status.classList.add('is-ok');
		else status.classList.add('stats-error');
		if (res.kind === 'unauthorized') {
			const fix = el('button', { type: 'button', class: 'stats-link' }, 'Open settings');
			fix.addEventListener('click', () => { dialog.close(); openStatsSettings(); });
			statusActions.append(fix);
		}
		if (res.kind === 'retry') {
			status.textContent = `${res.message} Saved to the outbox — it will be retried automatically. You can also download the file instead.`;
		}
		if (res.kind === 'invalid') {
			status.textContent = `Rejected by the server: ${res.message}. Fix it (e.g. relabel tracks) and re-send.`;
		}
	};

	const send = async () => {
		if (!session.selfPlayer) {
			const name = await pickSelf(session.mogi, session.selfName);
			if (!name) return;
			session.selfName = name;
			render();
		}
		sendBtn.disabled = true;
		status.className = 'stats-status';
		status.textContent = 'Sending…';
		tracks = await loadTracks();
		const res = await sendSession(session, tracks);
		showResult(res);
		sendBtn.textContent = session.sent ? '📤 Re-send' : '📤 Send to stats server';
		sendBtn.disabled = false;
	};

	changeSelf.addEventListener('click', async () => {
		const name = await pickSelf(session.mogi, session.selfName);
		if (name) { session.selfName = name; render(); }
	});
	labelBtn.addEventListener('click', async () => {
		dialog.close();
		await labelTracks(session, tracks, 0);
		openSessionDialog(session);
	});
	downloadBtn.addEventListener('click', () => {
		downloadJson(session.buildPayload(tracks, statsSettings.selfPlayerId), session.fileName);
	});
	sendBtn.addEventListener('click', send);
	closeBtn.addEventListener('click', () => dialog.close());
	dialog.addEventListener('close', () => dialog.remove());

	render();
	showResult(session.lastResult);
	dialog.showModal();

	if (server && opts.autoSend && session.selfPlayer) {
		await send();
	} else if (server && session.sent) {
		// Status check: "waiting" → "linked" once the Lounge table is matched.
		const st = await getSessionStatus(session.sessionId);
		if (st.ok && dialog.open) {
			const kind = st.status === 'matched_provisional' || st.status === 'confirmed' ? 'linked' : 'pending';
			session.lastResult = {
				kind, status: st.status, tableId: st.tableId,
				message: describeStatus(st.status, st.tableId) + (st.reason ? ` (${st.reason})` : ''),
			};
			showResult(session.lastResult);
		}
	}
}
