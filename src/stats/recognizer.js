// Track recognition from a race's results-screen frame, in the browser.
// A copy of the fingerprint and nearest-example code of MKW Advanced Stats' album import
// (public/js/album/reader.js): the labelled examples come from that server, so the numbers
// here must match its code exactly. Change both together.
//
// 1) palette: the background's colours (left of the results panel, your kart masked out)
// 2) embedding: MobileNet v2 (off-the-shelf image model) of the same area: textures and objects
// Both are computed from a 256×144 JPEG thumbnail of the frame, like the server's examples.
// Only used when a stats server is configured; the model loads from jsdelivr on first use.

const TH = { panelX: 140, top: 17 };                          // thumbnail coordinates (frame ÷ 7.5)
/** @param {number} x @param {number} y */
const inKart = (x, y) => x >= 30 && x <= 110 && y >= 38 && y <= 116; // where your kart usually sits

/** @param {ImageBitmap} img */
function palette(img) {
	const c = new OffscreenCanvas(256, 144);
	const ctx = /** @type {OffscreenCanvasRenderingContext2D} */(c.getContext('2d', { willReadFrequently: true }));
	ctx.drawImage(img, 0, 0, 256, 144);
	const d = ctx.getImageData(0, 0, TH.panelX, 144).data;
	const hist = new Float32Array(112);
	let n = 0;
	for (let y = TH.top; y < 144; y++) for (let x = 0; x < TH.panelX; x++) {
		if (inKart(x, y)) continue;
		const k = (y * TH.panelX + x) * 4, r = d[k] / 255, g = d[k + 1] / 255, b = d[k + 2] / 255;
		const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
		n++;
		if (sat < 0.15) { hist[108 + Math.min(3, Math.floor(mx * 4))]++; continue; } // greys by brightness
		const dd = mx - mn;
		let hue = mx === r ? ((g - b) / dd) % 6 : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
		hue = (hue * 60 + 360) % 360;
		hist[Math.floor(hue / 30) * 9 + Math.min(2, Math.floor(sat * 3)) * 3 + Math.min(2, Math.floor(mx * 3))]++;
	}
	return Uint8Array.from(hist, v => Math.round(Math.sqrt(v / (n || 1)) * 255));
}

/** @type {Promise<any>|null} */
let model = null;
/** @param {string} src */
function loadScript(src) {
	return new Promise((resolve, reject) => {
		const s = document.createElement('script');
		s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`Could not load ${src}`));
		document.head.append(s);
	});
}

/** MobileNet v2, loaded once (about 14 MB the first time, then cached by the browser). */
export function loadModel() {
	const g = /** @type {any} */(globalThis);
	model ??= (async () => {
		if (!g.tf) await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');
		if (!g.mobilenet) await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js');
		return g.mobilenet.load({ version: 2, alpha: 1.0 });
	})().catch(e => { model = null; throw e; });
	return model;
}

/** @param {ImageBitmap} img */
async function embedding(img) {
	const m = await loadModel();
	const c = new OffscreenCanvas(224, 224);
	const ctx = /** @type {OffscreenCanvasRenderingContext2D} */(c.getContext('2d', { willReadFrequently: true }));
	ctx.drawImage(img, 0, TH.top, TH.panelX - 1, 144 - TH.top, 0, 0, 224, 224);
	const pixels = ctx.getImageData(0, 0, 224, 224);
	const t = m.infer(pixels, true);
	const v = /** @type {Float32Array} */(await t.data());
	t.dispose();
	let max = 0; for (const x of v) max = Math.max(max, Math.abs(x));
	return Int8Array.from(v, x => Math.round((x / (max || 1)) * 127)); // scale-free: compared by angle
}

/**
 * @typedef {{palette: Uint8Array, embedding: Int8Array|null}} Fingerprints
 */

/**
 * Both fingerprints from a JPEG thumbnail (Blob). The embedding is null if the model can't load.
 * @param {Blob} thumbBlob
 * @returns {Promise<Fingerprints>}
 */
export async function fingerprints(thumbBlob) {
	const img = await createImageBitmap(thumbBlob);
	try {
		const p = palette(img);
		let e = null;
		try { e = await embedding(img); } catch (err) { console.warn('[tracks] image model unavailable:', /** @type {Error} */(err).message); }
		return { palette: p, embedding: e };
	} finally { img.close(); }
}

/**
 * The server's thumbnail of a results screen: the frame scaled to 1920×1080, then to 256×144, JPEG 0.7.
 * @param {string} url Blob/object URL of the captured frame (race.snapshotUrl)
 */
export async function thumbnailOf(url) {
	const blob = await (await fetch(url)).blob();
	const bmp = await createImageBitmap(blob);
	const full = new OffscreenCanvas(1920, 1080);
	/** @type {OffscreenCanvasRenderingContext2D} */(full.getContext('2d')).drawImage(bmp, 0, 0, 1920, 1080);
	bmp.close();
	const c = new OffscreenCanvas(256, 144);
	/** @type {OffscreenCanvasRenderingContext2D} */(c.getContext('2d')).drawImage(full, 0, 0, 256, 144);
	return c.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
}

/** Fingerprints of a captured frame. @param {string} url */
export async function fingerprintFrame(url) {
	return fingerprints(await thumbnailOf(url));
}

// ---- nearest labelled backgrounds (palette + image model) ----

const PALETTE_WEIGHT = 0.3; // best mix in the server's test on labelled races

/** @param {string} s */
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
/** @param {Uint8Array} u8 */
const deq = u8 => Float32Array.from(u8, v => v / 255);
/** @param {Int8Array|null} i8 */
function prepEmb(i8) {
	if (!i8) return null;
	let n = 0; for (const x of i8) n += x * x;
	return { v: i8, n: Math.sqrt(n) || 1 };
}
/** @param {Float32Array} a @param {Float32Array} b */
function paletteDist(a, b) { let d = 0; for (let k = 0; k < a.length; k++) { const x = a[k] - b[k]; d += x * x; } return Math.sqrt(d); }
/** @param {{v:Int8Array,n:number}} a @param {{v:Int8Array,n:number}} b */
function embDist(a, b) { let dot = 0; for (let k = 0; k < a.v.length; k++) dot += a.v[k] * b.v[k]; return 1 - dot / (a.n * b.n); }

/**
 * @typedef {{track: string, p: string, e: string|null}} Example base64 palette / int8 embedding
 * @typedef {[string, number]} Scored [track abbr, score]; lower = more alike
 */

/**
 * Every track, best first, for one frame. For each track, take its closest example in each
 * fingerprint, scale each distance by the median across tracks for this frame, and mix.
 * @param {Example[]} examples
 * @returns {(query: Fingerprints) => Scored[]}
 */
export function makeScorer(examples) {
	const ex = examples.filter(x => x.p).map(x => ({ track: x.track, p: deq(unb64(x.p)), e: x.e ? prepEmb(new Int8Array(unb64(x.e).buffer)) : null }));
	return query => {
		if (!ex.length || !query?.palette) return [];
		const qp = deq(query.palette), qe = prepEmb(query.embedding);
		/** @type {Map<string, number>} */ const bp = new Map();
		/** @type {Map<string, number>} */ const be = new Map();
		for (const x of ex) {
			const dp = paletteDist(qp, x.p);
			if (!bp.has(x.track) || dp < /** @type {number} */(bp.get(x.track))) bp.set(x.track, dp);
			if (qe && x.e) { const de = embDist(qe, x.e); if (!be.has(x.track) || de < /** @type {number} */(be.get(x.track))) be.set(x.track, de); }
		}
		/** @param {Map<string, number>} m */
		const med = m => { const v = [...m.values()].sort((a, b) => a - b); return v[Math.floor(v.length / 2)] || 1; };
		const mp = med(bp), me = be.size ? med(be) : 1;
		const useEmb = be.size > 0;
		return /** @type {Scored[]} */([...bp.keys()]
			.map(t => [t, useEmb
				? PALETTE_WEIGHT * /** @type {number} */(bp.get(t)) / mp + (1 - PALETTE_WEIGHT) * (be.get(t) ?? me * 2) / me
				: /** @type {number} */(bp.get(t))]))
			.sort((a, b) => /** @type {number} */(a[1]) - /** @type {number} */(b[1]));
	};
}

export const REPEAT_PENALTY = 0.05;

/**
 * Picks for all races of one mogi together. Tracks are rarely picked twice in a mogi, so once a
 * track is taken (set by you, or the top guess of a more confident race) it costs a little extra
 * for the others: it stays a race's top guess only if it clearly beats that race's next choice.
 * @template K
 * @param {{key: K, scores: Scored[]}[]} races
 * @param {string[]} [typed] Tracks you already set yourself
 * @param {number} [k]
 * @returns {Map<K, string[]>} key → top tracks, best first
 */
export function suggestForMogi(races, typed = [], k = 3) {
	const taken = new Set(typed);
	/** @param {{scores: Scored[]}} r */
	const margin = r => (r.scores.length > 1 ? r.scores[1][1] - r.scores[0][1] : Infinity);
	const out = new Map();
	for (const r of [...races].sort((a, b) => margin(b) - margin(a))) { // most confident first
		const ranked = r.scores.map(([t, sc]) => /** @type {Scored} */([t, sc + (taken.has(t) ? REPEAT_PENALTY : 0)])).sort((a, b) => a[1] - b[1]).map(([t]) => t);
		if (ranked.length) taken.add(ranked[0]);
		out.set(r.key, ranked.slice(0, k));
	}
	return out;
}
