import { esc } from '../escape.js'

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i

// ![[image.png]] → <img src="blob:…">; ![[file.pdf]] → download chip.
// Missing files keep the original text so nothing silently disappears.
export function embedExtension({ collect, resolveFile, track }) {
  return {
    name: 'embed',
    level: 'inline',
    start(src) {
      const index = src.indexOf('![[')
      return index < 0 ? undefined : index
    },
    tokenizer(src) {
      const match = /^!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(src)
      if (!match) return undefined
      return { type: 'embed', raw: match[0], path: match[1].trim() }
    },
    renderer(token) {
      collect.embeds.push({ path: token.path, isMissing: !resolveFile(token.path) })
      collect.links.push({ target: token.path, display: token.path, isEmbed: true, anchor: null })

      const file = resolveFile(token.path)
      if (!file) return `<span class="embed-missing">${esc(token.raw)}</span>`

      const url = track(URL.createObjectURL(file))
      const name = esc(token.path.split('/').pop())
      if (IMAGE.test(token.path)) return `<img data-embed="${esc(token.path)}" src="${url}" alt="${name}">`
      return `<a class="embed-file" data-embed="${esc(token.path)}" download="${name}" href="${url}">${name}</a>`
    },
  }
}
