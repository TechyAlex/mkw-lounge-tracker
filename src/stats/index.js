// Entry point for the opt-in stats export (track labeling + MKW Advanced Stats upload).
// Kept separate from upstream code: main.js only calls setupStatsSettings() and connectStatsExport().

/** @typedef {import("../mogi.js").Mogi} Mogi */

import { info } from '../ui/toast.js';
import { isDebugMode } from '../util.js';
import { flushOutbox } from './outbox.js';
import { SETTINGS_CHANGED_EVENT, statsSettings } from './settings.js';
import { StatsSession } from './session.js';
import { el } from './ui/dom.js';
import { runFinishFlow } from './ui/session-dialog.js';
import { openStatsSettings } from './ui/settings-dialog.js';

function injectStyles() {
	if (document.getElementById('stats-css')) return;
	const link = el('link', { rel: 'stylesheet', id: 'stats-css', href: new URL('./stats.css', import.meta.url).href });
	document.head.append(link);
}

/**
 * Add the settings button to the header and retry any queued uploads.
 * Call once on page load (before a session starts).
 */
export function setupStatsSettings() {
	injectStyles();
	const locale = document.getElementById('locale');
	const btn = el('button', { type: 'button', class: 'icon-btn stats-settings-btn', title: 'Stats server settings', 'aria-label': 'Stats server settings' }, '📊');
	btn.addEventListener('click', () => openStatsSettings());
	locale?.before(btn);

	// Retry queued uploads quietly. No requests at all unless a server is configured.
	if (statsSettings.serverConfigured) flushOutbox().catch(() => { });
	window.addEventListener('online', () => { if (statsSettings.serverConfigured) flushOutbox().catch(() => { }); });
}

/**
 * Wire the stats export into a running mogi: a "Stats" button next to the export buttons,
 * which starts the finish flow (self pick → track labeling → send) once the mogi has ended.
 * @param {Mogi} mogi
 */
export function connectStatsExport(mogi) {
	// Wars ("WAR - Tag1 vs Tag2") are not tracked: no Stats button, no finish flow, nothing sent.
	if (mogi.roster.isWar) {
		if (isDebugMode()) Object.assign(window, { mmStats: { mogi, session: null } });
		return null;
	}

	// selfName starts empty: the picker is shown once per mogi, preselecting the remembered name.
	const session = new StatsSession(mogi);

	const btn = el('button', { type: 'button', disabled: true, title: 'Label tracks and export/send stats' }, '📊 Stats');
	document.getElementById('exportScores')?.before(btn);
	btn.addEventListener('click', () => runFinishFlow(session));

	const refresh = () => {
		btn.hidden = !statsSettings.featureEnabled;
		btn.disabled = !mogi.ended;
	};
	window.addEventListener(SETTINGS_CHANGED_EVENT, refresh);

	// Nothing opens by itself when the mogi ends (so the Lounge table can be copied first);
	// the finish flow starts only from the Stats button. Just point at it once.
	mogi.addEventListener('update', () => {
		refresh();
		if (!mogi.ended) { session.endHintShown = false; return; }
		if (session.endHintShown || session.sent || !statsSettings.featureEnabled) return;
		session.endHintShown = true;
		setTimeout(() => info('Mogi finished — click 📊 Stats when you\'re ready to label tracks and send stats.', { timeout: 6000 }), 400);
	});
	refresh();

	if (isDebugMode()) Object.assign(window, { mmStats: { mogi, session } });
	return session;
}
