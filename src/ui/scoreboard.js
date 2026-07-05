/** @typedef {import("../mogi.js").Mogi} Mogi */

import { fmt, t } from "../i18n/i18n.js";
import { RACE_COUNT } from "../mogi.js";
import { ctx2d, toLetter } from "../util.js";
import { openEditRace } from "./edit-race-dialog.js";
import { openEditRoster } from "./edit-roster-dialog.js";
import { success } from "./toast.js";

/**
 * @param {HTMLTableElement} scoreTable
 * @param {HTMLTableElement} gapTable
 * @param {HTMLVideoElement} video
 * @param {Mogi} mogi
 */
export function connectScoreboard(scoreTable, gapTable, video, mogi) {
	mogi.addEventListener('update', () => {
		const roster = [...mogi.roster];
		const totals = mogi.calculatePlayerScores();
		/** @type {Map<number, number>} */
		const totalsPerTeam = new Map();
		totals.forEach((score, playerId) => {
			const teamId = roster.find(p => p.id === playerId)?.seed || 0;
			totalsPerTeam.set(teamId, (totalsPerTeam.get(teamId) || 0) + score);
		});
		roster.sort((p1, p2) => (totalsPerTeam.get(p2.seed)||0) - (totalsPerTeam.get(p1.seed)||0) // decreasing team score
			|| p1.seed - p2.seed // increasing seed (to keep teams together)
			|| (totals.get(p2.id)||0) - (totals.get(p1.id)||0) // decreasing player score
			|| p1.id.localeCompare(p2.id) // alphabetically by ID
		);

		const races = mogi.races;
		let totalScore = 0;

		// Previous-race scores for rank-change arrows
		const prevTotals = new Map();
		if (races.length > 1) {
			for (const race of races.slice(0, -1)) {
				for (const [pid, score] of race.calculatePlayerScores()) {
					prevTotals.set(pid, (prevTotals.get(pid) ?? 0) + score);
				}
			}
		}
		const prevTotalsPerTeam = new Map();
		prevTotals.forEach((score, playerId) => {
			const pl = mogi.roster.byId(playerId);
			if (pl) prevTotalsPerTeam.set(pl.seed, (prevTotalsPerTeam.get(pl.seed) || 0) + score);
		});

		// Build <thead>
		const thead = document.createElement('thead');
		const hr = document.createElement('tr');
		const hRank = document.createElement('th'); hRank.textContent = '#'; hr.appendChild(hRank);
		if (mogi.playersPerTeam > 1) {
			const hTeam = document.createElement('th'); hTeam.textContent = t('scoreboard.team'); hr.appendChild(hTeam);
		}
		const hPlayer = document.createElement('th'); hPlayer.textContent = t('scoreboard.player'); hr.appendChild(hPlayer);
		for (let i = 0; i < RACE_COUNT; i++) {
			const th = document.createElement('th'); th.textContent = t('scoreboard.raceNumber', { number: i + 1 }); hr.appendChild(th);
		}
		const hTot = document.createElement('th'); hTot.textContent = t('scoreboard.total'); hr.appendChild(hTot);
		if (mogi.playersPerTeam > 1) {
			hTot.colSpan = 2;
		}
		thead.appendChild(hr);

		// Per-row gap value: shown in the row that is the last of its group (player in FFA, team in team mode),
		// representing the score gap down to the next group. Rendered in a separate offset table so it visually
		// sits at the boundary between the two rows/groups it compares.
		const gapValues = roster.map((p, i) => {
			const next = roster[i + 1];
			if (!next) return null;
			if (mogi.playersPerTeam > 1 && next.seed === p.seed) return null;
			const thisScore = mogi.playersPerTeam > 1 ? (totalsPerTeam.get(p.seed) || 0) : (totals.get(p.id) || 0);
			const nextScore = mogi.playersPerTeam > 1 ? (totalsPerTeam.get(next.seed) || 0) : (totals.get(next.id) || 0);
			return thisScore - nextScore;
		});

		// Build <tbody>
		const tbody = document.createElement('tbody');
		tbody.classList.toggle('team-mode', mogi.playersPerTeam > 1);
		let team = null;
		for (const p of roster) {
			const tr = document.createElement('tr');
			const teamScore = totalsPerTeam.get(p.seed) || 0;
			const playerScore = totals.get(p.id) || 0;
			const teamRank = teamScore > 0 ? Array.from(totalsPerTeam.values()).filter(x => x > teamScore).length + 1 : 0;
			const playerRank = playerScore > 0 ? Array.from(totals.values()).filter(x => x > playerScore).length + 1 : 0;

			// True for first player of each team (or every player in FFA)
			const isFirstOfTeam = mogi.playersPerTeam === 1 || team !== p.seed;

			// Rank cell (#) — added before team/player cells
			if (isFirstOfTeam) {
				const rowSpan = mogi.playersPerTeam > 1 ? mogi.playersPerTeam : 1;
				const rank = mogi.playersPerTeam > 1 ? teamRank : playerRank;
				const prevScore = mogi.playersPerTeam > 1
					? (prevTotalsPerTeam.get(p.seed) || 0)
					: (prevTotals.get(p.id) ?? 0);
				const prevRank = races.length <= 1 ? rank : mogi.playersPerTeam > 1
					? Array.from(prevTotalsPerTeam.values()).filter(x => x > prevScore).length + 1
					: Array.from(prevTotals.values()).filter(x => x > prevScore).length + 1;
				const rankChange = races.length <= 1 ? 0 : prevRank - rank;

				const tdRank = document.createElement('td');
				tdRank.classList.add('mono');
				if (rowSpan > 1) tdRank.rowSpan = rowSpan;
				tdRank.textContent = rank > 0 ? String(rank) : '—';
				if (rank > 0 && races.length > 1 && rankChange !== 0) {
					const span = document.createElement('span');
					span.className = rankChange > 0 ? 'positive' : 'negative';
					span.textContent = rankChange > 0 ? ` ↑${rankChange}` : ` ↓${Math.abs(rankChange)}`;
					tdRank.appendChild(span);
				}
				tr.appendChild(tdRank);
			}

			if (mogi.playersPerTeam > 1 && team !== p.seed) {
				const teamData = mogi.teamBySeed(p.seed);
				const tdTeam = document.createElement('td');
				tdTeam.rowSpan = mogi.playersPerTeam;
				const icon = document.createElement('span');
				icon.textContent = teamData?.icon || '👥';
				icon.classList.add('team-icon');
				tdTeam.append(icon, document.createElement('br'), `${teamData?.tag || toLetter(p.seed)}`);

				if (mogi.teams.length === 2 && races.length > 0) {
					const lastRace = races.at(-1);
					const lastRaceScores = new Map();
					for (const placement of lastRace.placements) {
						const pl = mogi.roster.byId(placement.playerId ?? '');
						if (!pl) continue;
						lastRaceScores.set(pl.seed, (lastRaceScores.get(pl.seed) || 0) + placement.score);
					}
					const myScore = lastRaceScores.get(p.seed) || 0;
					const otherScore = lastRaceScores.get(p.seed === 1 ? 2 : 1) || 0;
					const delta = myScore - otherScore;
					const deltaEl = document.createElement('div');
					deltaEl.className = `race-delta ${delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'muted'}`;
					deltaEl.textContent = delta > 0 ? `+${delta}` : `${delta}`;
					tdTeam.appendChild(deltaEl);
				}

				tr.appendChild(tdTeam);
				tdTeam.style.background = `${teamData?.colour || '#000000'}20`;
			}
			const tdName = document.createElement('td');
			tdName.textContent = p.activePlayer.name;
			tdName.classList.add('player', `rank-${playerRank}`);
			tr.appendChild(tdName);

			// Each race: show placement number; use '—' if not present
			for (const r of mogi.races) {
				const td = document.createElement('td');
				// find this player's placement in this race
				const row = r.placements.find(x => x.playerId === p.id);
				const placement = row && !row.dc ? row.placement : null;
				td.classList.add('place', `place-${placement ?? 0}`, `rank-${playerRank}`);
				td.textContent = placement ? fmt.place(placement) : t('blank');
				tr.appendChild(td);
			}
			for (let i = races.length; i < RACE_COUNT; i++) {
				const td = document.createElement('td');
				td.classList.add('muted', `rank-${playerRank}`);
				td.textContent = t('blank');
				tr.appendChild(td);
			}

			const tdTotal = document.createElement('td');
			tdTotal.classList.add(`rank-${playerRank}`);
			tdTotal.append(String(playerScore).padStart(3, '\u2007'));
			if (races.length > 0 && races.length < RACE_COUNT) {
				const pace = Math.round(playerScore * RACE_COUNT / races.length);
				const paceEl = document.createElement('div');
				paceEl.className = 'race-delta muted';
				paceEl.textContent = `\u2192${pace}`;
				tdTotal.appendChild(paceEl);
			}
			tr.appendChild(tdTotal);

			if (mogi.playersPerTeam > 1 && team !== p.seed) {
				team = p.seed;
				const tdTeam = document.createElement('td');
				tdTeam.classList.add(`rank-${teamRank}`);
				tdTeam.rowSpan = mogi.playersPerTeam;
				tdTeam.textContent = String(teamScore).padStart(3, '\u2007');
				tr.appendChild(tdTeam);
			}

			tbody.appendChild(tr);

			totalScore += playerScore;
		}

		// Build <tfoot> with Edit buttons per race column
		const tfoot = document.createElement('tfoot');
		const fr = document.createElement('tr');
		fr.appendChild(document.createElement('td')); // # column placeholder
		const rosterButton = document.createElement('button');
		rosterButton.textContent = t('scoreboard.editRosterButton');
		rosterButton.addEventListener('click', () => openEditRoster(mogi, video));
		const fEditRoster = document.createElement('td');
		fEditRoster.append(rosterButton);
		if (mogi.playersPerTeam > 1) {
			fEditRoster.colSpan = 2;
		}
		fr.appendChild(fEditRoster);
		for (let i = 0; i < RACE_COUNT; i++) {
			const td = document.createElement('td');
			const btn = document.createElement('button');
			btn.textContent = "✏️";
			if( i < races.length) {
				btn.addEventListener('click', () => openEditRace(mogi, i));
			}
			else {
				btn.disabled = true;
			}
			td.appendChild(btn);
			fr.appendChild(td);
		}
		const fTotal = document.createElement('td');
		fTotal.append(`${totalScore}`, document.createElement('br'), `/ ${mogi.maxScore}`);
		if (mogi.playersPerTeam > 1) {
			fTotal.colSpan = 2;
		}
		fr.appendChild(fTotal);
		tfoot.appendChild(fr);

		// Swap table content
		scoreTable.replaceChildren(thead, tbody, tfoot);

		// Build the Gap table: a separate single-column table kept in step with the main
		// table's row heights, then offset by half a row so each value sits at the boundary
		// between the two rows/groups it compares, instead of adding extra rows to the main table.
		const gapThead = document.createElement('thead');
		const gapHr = document.createElement('tr');
		const gapHeader = document.createElement('th'); gapHeader.textContent = 'Gap'; gapHr.appendChild(gapHeader);
		gapThead.appendChild(gapHr);

		const gapTbody = document.createElement('tbody');
		roster.forEach((p, i) => {
			const tr = document.createElement('tr');
			const td = document.createElement('td');
			const gap = gapValues[i];
			if (gap !== null && gap !== undefined) {
				td.textContent = gap > 0 ? `+${gap}` : gap < 0 ? `${gap}` : `=`;
				td.className = gap > 0 ? 'gap-value gap-value--ahead' : gap < 0 ? 'gap-value gap-value--behind' : 'gap-value gap-value--tied';
			} else {
				// Non-breaking space keeps this cell's line-box (and thus row height) identical
				// to a populated cell — an empty <td> would otherwise collapse shorter, throwing
				// off the row-for-row height match with the main table that the offset relies on.
				td.textContent = ' ';
			}
			tr.appendChild(td);
			gapTbody.appendChild(tr);
		});

		const mainRow = scoreTable.tBodies[0]?.rows[0];
		const rowHeight = mainRow ? mainRow.getBoundingClientRect().height : 0;
		for (const tr of gapTbody.rows) {
			// Force each row to match the main table's row height exactly (a gap row's own
			// content is usually shorter, e.g. one line vs. the main table's total+pace lines) —
			// without this, rows stack using their own shorter natural height and the offset
			// below drifts further off-boundary with each row.
			tr.style.height = `${rowHeight}px`;
			tr.style.position = 'relative';
			tr.style.top = `${rowHeight / 2}px`;
		}

		gapTable.replaceChildren(gapThead, gapTbody);
	});
}

function makeScoreboardDialog() {
	const dialog = document.createElement('dialog');
	dialog.innerHTML = `
		<form method="dialog" class="modal">
			<h3>${t('scoreboard.title')}</h3>
			<div></div>
			<footer>
				<button type="button" class="btn--primary">${t('exportScores.close')}</button>
			</footer>
		</form>
	`;
	const snapshot = /** @type {HTMLDivElement} */(dialog.querySelector('div'));
	const close = /** @type {HTMLButtonElement} */(dialog.querySelector('button'));
	document.body.append(dialog);
	dialog.addEventListener('close', () => dialog.remove());
	return { dialog, snapshot, close };
}

/**
 * @param {HTMLButtonElement} captureButton
 * @param {HTMLTableElement} scoreTable
 * @param {HTMLTableElement} gapTable
 */
export function connectScoreboardScreenshotter(captureButton, scoreTable, gapTable) {
	captureButton.addEventListener('click', () => {
		const canvas = document.createElement('canvas');
		const padding = 16;
		const scoreBox = scoreTable.getBoundingClientRect();
		const gapBox = gapTable.getBoundingClientRect();
		const tableBox = {
			left: Math.min(scoreBox.left, gapBox.left),
			top: Math.min(scoreBox.top, gapBox.top),
			width: Math.max(scoreBox.right, gapBox.right) - Math.min(scoreBox.left, gapBox.left),
			height: Math.max(scoreBox.bottom, gapBox.bottom) - Math.min(scoreBox.top, gapBox.top)
		};
		canvas.width = tableBox.width + padding * 2;
		canvas.height = tableBox.height + padding * 2;
		const ctx = ctx2d(canvas);
		ctx.translate(padding - tableBox.left, padding - tableBox.top);
		const { backgroundColor } = getComputedStyle(scoreTable.closest('.panel') ?? scoreTable);
		ctx.fillStyle = backgroundColor;
		ctx.fillRect(tableBox.left - padding, tableBox.top - padding, tableBox.width + padding * 2, tableBox.height + padding * 2);
		/**
		 * @param {Element} el
		 * @param {number} depth
		 */
		function drawElementBox(el, depth = 0) {
			const box = el.getBoundingClientRect();
			const { borderWidth, borderColor, backgroundColor, color, fontFamily, fontSize, lineHeight, textAlign, paddingInline } = window.getComputedStyle(el);
			ctx.fillStyle = backgroundColor;
			ctx.fillRect(box.left, box.top, box.width, box.height);
			const lineWidth = parseFloat(borderWidth || '0');
			if( lineWidth ) {
				ctx.fillStyle = borderColor;
				ctx.fillRect(box.left, box.top, box.width, lineWidth);
				ctx.fillRect(box.left, box.top, lineWidth, box.height);
				ctx.fillRect(box.left + box.width - lineWidth, box.top, lineWidth, box.height);
				ctx.fillRect(box.left, box.top + box.height - lineWidth, box.width, lineWidth);
			}
			if( depth > 0 ) {
				for (const child of el.children) {
					drawElementBox(child, depth - 1);
				}
			}
			else {
				// if element contains a button, skip it
				if (el.querySelector('button')) return;
				// if element contains a newline, handle it as a special case (total score cell)
				if (el.querySelector('br')) {
					const [first, _, last] = el.childNodes;
					ctx.fillStyle = color;
					ctx.font = `${fontSize} ${fontFamily}`;
					ctx.textAlign = textAlign === 'left' ? 'start' : textAlign === 'right' ? 'end' : 'center';
					ctx.textBaseline = 'middle';
					const offset = textAlign === 'left' ? parseFloat(paddingInline) : textAlign === 'right' ? box.width - parseFloat(paddingInline) : box.width / 2;
					ctx.fillText(first.textContent ?? '', box.left + offset, box.top + box.height / 2 - parseInt(lineHeight) / 2);
					ctx.fillText(last.textContent ?? '', box.left + offset, box.top + box.height / 2 + parseInt(lineHeight) / 2);
					return;
				}
				// if element contains text, draw it
				if (el.textContent) {
					ctx.fillStyle = color;
					ctx.font = `${fontSize} ${fontFamily}`;
					ctx.textAlign = textAlign === 'left' ? 'start' : textAlign === 'right' ? 'end' : 'center';
					ctx.textBaseline = 'middle';
					const offset = textAlign === 'left' ? parseFloat(paddingInline) : textAlign === 'right' ? box.width - parseFloat(paddingInline) : box.width / 2;
					ctx.fillText(el.textContent, box.left + offset, box.top + box.height / 2);
					return;
				}
			}
		}
		drawElementBox(scoreTable, 3); // table, thead/tbody/tfoot, tr, th/td
		drawElementBox(gapTable, 3);

		function fallbackDialog() {
			const { dialog, snapshot, close } = makeScoreboardDialog();
			snapshot.append(canvas);
			close.addEventListener('click', () => dialog.close());
			dialog.showModal();
		}
		// try to copy to clipboard
		if( 'ClipboardItem' in window ) {
			canvas.toBlob(blob => {
				if( blob) {
					navigator.clipboard.write([
						new ClipboardItem({
							'image/png': blob,
						})
					]);
					success(t('exportScores.copiedToClipboard'));
				}
				else {
					fallbackDialog();
				}
			});
		}
		else {
			fallbackDialog();
		}
	});
}
