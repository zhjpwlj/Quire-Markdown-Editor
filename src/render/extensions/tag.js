import { esc } from '../escape.js'

// DECISION: a tag needs start-of-line or whitespace before '#', so URL fragments like
// example.com/#section never become tags. The trade-off is that #tag mid-word is not a tag.
export function tagExtension() {
  return {
    name: 'tag',
    level: 'inline',
    start(src) {
      const match = /(?:^|\s)#[a-zA-Z0-9_-]+/.exec(src)
      return match ? match.index : undefined
    },
    tokenizer(src) {
      // Consumes the leading whitespace and re-emits it, so spacing is preserved.
      const match = /^(\s*)#([a-zA-Z0-9_-]+)/.exec(src)
      if (!match) return undefined
      return { type: 'tag', raw: match[0], leading: match[1], name: match[2] }
    },
    renderer(token) {
      return `${token.leading}<a class="tag">#${esc(token.name)}</a>`
    },
  }
}
