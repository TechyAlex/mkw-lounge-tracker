# MKW Mogi Manager

## Overview

**MKW Mogi Manager** is a tool to simplify tracking scores during competitive **Mario Kart World Lounge mogis**. Instead of manually writing down results, the app captures screenshots of the scoreboard, reads the names and scores, and keeps track of everything automatically. At the end of the session, you can export results in the format needed for **Lounge Discord bots**, along with a full package of screenshots and race data for reference.

👉 Live site: [https://pfqniet.github.io/mkw-lounge-tracker/](https://pfqniet.github.io/mkw-lounge-tracker/)

## Quick Start

1. **Open the app** (see link above).
2. **Paste participants list** from Lounge bot into the app.
3. **Select video device** (your OBS virtual webcam).
4. *(Optional)* Use **Pause Menu → Auto-fill** to set names.
5. After each race, on the **results screen**:

   * **Click Capture**, or
   * Use **Auto-Capture** (when you take a Switch screenshot).
6. **Check results** and fix any names/scores if needed.
7. After **12 races**, **Finish Session** → export to Discord or download ZIP.

For detailed instructions, see below.

## Key Features

* **Automatic Score Tracking** – Capture the scoreboard and let the app fill in scores for you.
* **Supports All Formats** – Free-for-all, 2v2, 3v3, 4v4, and 6v6.
* **Session Management** – Keeps track of all 12 races in a standard mogi.
* **Auto-Capture** – Optionally, the app can capture results automatically whenever you take a screenshot on your Switch.
* **Easy Fixes** – If the app makes a mistake, you can quickly correct names or scores before moving on.
* **Export Options** – Generate results for posting in Lounge, and download a ZIP with all data and screenshots.
* **Multiple Languages** – Available in English, French, German, and Japanese.

## What You Need

* A computer with a **capture card** connected to your console.
* A **web browser** (latest Chrome, Firefox, or Safari recommended).
* **OBS** or similar software to output your gameplay as a virtual webcam.

## How to Use

### Start a Session

1. **Copy and paste** the **participants list** provided by the Lounge bot into the app (e.g. `1. Name1, Name2 (12345 MMR)` for a 2v2 format).

![Paste player list](./img/docs/1-paste-roster.jpg)

2. **Select** your video capture device (the virtual webcam from OBS).

3. *(Optional)* Use the **Pause Menu** in-game and click **Auto-fill** to let the app learn player names ahead of time.

![Setup teams](./img/docs/2-edit-roster.jpg)

### After Each Race

1. When the **race results screen** is shown *(before it transitions to the overall session rankings)*, trigger a capture:

   * **Click** **Capture** in the app, **or**
   * Use **Auto-Capture** (if enabled), which listens for when you take a Switch screenshot and captures automatically.
2. The app will **read the names and scores** from the results screen.

![Capture results](./img/docs/3-capture-results.jpg)

3. **Check the results**:

   * ✅ If everything looks good, continue.
   * ❌ If something is wrong, **click to edit** the player name or score.

![Edit race](./img/docs/5-edit-race.jpg)

### Finishing Up

1. After **12 races**, verify your results.

![Scoreboard](./img/docs/4-scoreboard.jpg)

2. Choose how you want to export:

   * **Discord Export** – Copy the formatted scores to post in Lounge.
   * **Full Export** – Download a ZIP with results, a summary, and all screenshots.

![Lounge export](./img/docs/6-export-scores.jpg)

## Optional: Track Labeling & Stats Server

This fork can label which track each race was on and export a mogi as JSON for a self-hosted **MKW Advanced Stats** server. It is **off unless you turn it on**: with no stats server configured (and track labeling off), the app works exactly as before and sends nothing anywhere.

**Setup** – click **📊** in the header:

* **Server URL** – your stats server (must be `https://`). Leave empty to turn sending off.
* **Upload token** – stored only in this browser (`localStorage`), never in the repo or the export.
* **Your Lounge player ID** – optional; lets the server follow you across name changes.
* **Label tracks after each mogi** – on by default when a server is set; can be turned on without a server too.
* **Test connection** checks the token and downloads the server's track list.

Wars (`WAR - Tag1 vs Tag2` rosters) are never labeled or sent.

**After race 12**, nothing interrupts you: copy the Lounge table as usual. When you're ready, click **📊 Stats** (next to *Export scores*). The app asks which player you are (remembered for next time), then shows each race's results screenshot one at a time and asks **"What track is this?"**:

* Type the abbreviation (case-insensitive), e.g. `bc` → Bowser's Castle, `rgv1` → Ghost Valley 1 (retro). Suggestions appear as you type; **↑/↓** picks one, **Tab** completes.
* **Enter** accepts and moves on, **Shift+Enter** goes back, **?** marks the track as unknown.
* **Connecting tracks**: type `FROM>TO` (e.g. `mbc>cc`) or press **↪ Connecting**. Either side can be `?`.

The mogi is then sent to the server ("Sent ✓ — waiting for the Lounge table" is the normal result). If the server can't be reached, the upload is kept in a local outbox and retried later. **💾 Download session JSON** is always available, and clicking **📊 Stats** again lets you fix labels or re-send. Screenshots are never uploaded.

**Live track recognition and next-track picks** (only while a stats server and token are set; turn off with *Recognise each race's track and suggest the next track* in 📊 settings). A **This room** / **Next track** / **Tracks** panel appears under the scoreboard:

* **This room** (open before race 1, folded after; click to reopen): from the room list's MMRs, the MMR you'd gain or lose for each place you could finish, where you'd finish if the room finished in MMR order, and where you stand right now. Below it, people in the room you have a history with: opponents who usually finish above or below you, and how you do with your teammates (`POST /api/stats/room`; only the room list's names and MMRs are sent).
* Each captured race's track is recognised from its results screen, using the server's labelled races (`GET /api/import/track-examples`, cached in this browser) and an image model loaded once from jsdelivr (~14 MB). All races of the mogi are ranked together, so a track rarely gets picked twice.
* The best guess is used as the label: nothing to do if it's right. Click guess **2** or **3** to swap, or type any abbreviation in **Other…** and press Enter. Tracks you set are never overwritten. The same guesses appear in the 📊 Stats labeler (**Alt+1/2/3**); if every race already has a track, it goes straight to the summary.
* **Next track**: where you finished the last race is where you start the next one. The panel shows the server's *Pick a track for your start position* ranking for that place (`GET /api/stats/start-positions`): the best tracks to pick, and the ones to avoid. Tracks already played this mogi are marked.
* Only fingerprints are computed in the browser; screenshots still never leave it.

**Export format notes** (`schemaVersion: 1`):

* The track list comes from the server (`GET /api/tracks`), with [`src/stats/tracks.json`](./src/stats/tracks.json) as the bundled fallback. Abbreviations are sent uppercase.
* A connecting track is sent as `track.abbr` = destination, `track.from` = origin (or `null` if unknown) and `track.routeType` = `"connecting"`. Normal tracks have `from: null, routeType: null`.
* Race numbers are 1–12 in counted order. Results use the roster's Lounge names, and `status` is `ok` or `dc`.

The code for this feature lives in [`src/stats/`](./src/stats/).

## Fixing Problems

Sometimes the app might not read everything perfectly. Here's what you can do:

* **No names detected** – Make sure you're on the results or pause screen and try again.
* **Wrong name or score** – Click to edit it before moving on.
* **Missing players** – Add them in manually if needed.

## Limitations

* The app may struggle if players have **very similar in-game names**, or even **identical names in team formats**. It will do its best to match them correctly, but you may need to step in and fix these manually.
* OCR accuracy depends on **video quality**. Lower brightness or sharpness may make results harder to read.

## Tips

* Always **capture from the race results screen**, not the session rankings.
* Use the **pause menu at the start** for smoother auto-filling of names during the session.
* **Team formats** are detected automatically from the participants list.
* You don't need to upload anything online. Everything runs **locally in your browser**.

---

That's it! **MKW Mogi Manager** is designed to save you time and effort so you can focus on racing. If something goes wrong, you always have the chance to fix it before results are final.

## Contributing & Feedback

This is an **open-source project**. If you'd like to contribute, report bugs, or suggest new features, please visit:

🔗 [**MKW Mogi Manager on GitHub**](https://github.com/PFQNiet/mkw-lounge-tracker)

Bug reports and feedback are always welcome through **GitHub issues**.
