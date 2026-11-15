import { Marked } from 'marked'
import { createBlobRegistry } from './blobUrlRegistry.js'
import { sanitize } from './sanitize.js'
import { wikilinkExtension } from './extensions/wikilink.js'
import { embedExtension } from './extensions/embed.js'
import { tagExtension } from './extensions/tag.js'

// §M5 heading slug. Duplicates get -1, -2 in document order.
function slugFor(text, used) {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section'
  const seen = used.get(base) ?? 0
  used.set(base, seen + 1)
  return seen === 0 ? base : `${base}-${seen}`
}

export class RenderPipeline {
  constructor({ resolveFile = () => null, isResolved = () => false } = {}) {
    this.resolveFile = resolveFile
    this.isResolved = isResolved
  }

  render(markdown = '') {
    const registry = createBlobRegistry()
    const collect = { links: [], embeds: [], headings: [] }
    const used = new Map()

    // A fresh Marked instance per render keeps heading counters and blob sets isolated.
    const marked = new Marked({ gfm: true })
    marked.use({
      extensions: [
        tagExtension(),
        wikilinkExtension({ collect, isResolved: this.isResolved }),
        embedExtension({ collect, resolveFile: this.resolveFile, track: registry.track }),
      ],
    })
    marked.use({
      renderer: {
        heading(token) {
          const text = token.text ?? ''
          const id = slugFor(text, used)
          collect.headings.push({ level: token.depth, id, text })
          // DOMPurify's DOM-clobbering guard drops id="title" and friends, so headings carry a
          // data-* placeholder that becomes the real id after sanitization.
          return `<h${token.depth} data-heading-id="${id}">${this.parser.parseInline(token.tokens)}</h${token.depth}>\n`
        },
      },
    })

    const html = sanitize(marked.parse(markdown)).replace(/ data-heading-id="([^"]*)"/g, ' id="$1"')

    return {
      html,
      links: collect.links,
      embeds: collect.embeds,
      headings: collect.headings,
      renderId: registry.renderId,
    }
  }
}
