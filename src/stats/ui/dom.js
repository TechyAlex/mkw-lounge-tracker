/**
 * Tiny element builder. Text children are inserted as text (never HTML).
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, string|boolean>} [attrs]
 * @param {...(Node|string|null|undefined|false)} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function el(tag, attrs = {}, ...children) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v === false) continue;
		node.setAttribute(k, v === true ? '' : v);
	}
	for (const c of children) {
		if (c === null || c === undefined || c === false) continue;
		node.append(c);
	}
	return node;
}
