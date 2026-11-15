import { esc } from '../escape.js'

// [[note]], [[note|display]], [[note#heading]].
// Resolution is a stub until M6, so every link renders unresolved for now.
export function wikilinkExtension({ collect, isResolved = () => false }) {
  return {
    name: 'wikilink',
    level: 'inline',
    start(src) {
      const index = src.indexOf('[[')
      return index < 0 ? undefined : index
    },
    tokenizer(src) {
      const match = /^\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/.exec(src)
      if (!match) return undefined
      return {
        type: 'wikilink',
        raw: match[0],
        target: match[1].trim(),
        anchor: match[2]?.trim() ?? null,
        display: (match[3] ?? match[1]).trim(),
      }
    },
    renderer(token) {
      collect.links.push({
        target: token.target,
        display: token.display,
        isEmbed: false,
        anchor: token.anchor,
      })
      const resolved = isResolved(token.target)
      const anchor = token.anchor ? ` data-anchor="${esc(token.anchor)}"` : ''
      const className = resolved ? 'wikilink' : 'wikilink wikilink-unresolved'
      return `<a data-wikilink="${esc(token.target)}"${anchor} class="${className}">${esc(token.display)}</a>`
    },
  }
}
