// RenderPipeline (§6.4). marked for markdown, DOMPurify for the whitelist, plus
// wiki-link, embed and tag extensions. Resolvers are injected so LinkIndex (M6) can
// replace the temporary path scan without touching this module.
import { Marked } from 'marked'
import DOMPurify from 'dompurify'

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp'])

const ALLOWED_TAGS = [
  'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'img', 'input', 'li', 'ol', 'p', 'pre', 'span', 'strong', 'sub', 'sup',
  'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
]
const ALLOWED_ATTR = [
  'alt', 'checked', 'class', 'data-anchor', 'data-embed', 'data-path', 'data-tag',
  'data-wikilink', 'disabled', 'download', 'href', 'src', 'start', 'title', 'type',
]

const esc = (text) =>
  String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])

const extOf = (target) => (/\.([a-z0-9]+)$/i.exec(target)?.[1] ?? '').toLowerCase()
// ![[Note]] and ![[Note.md]] are links (v4.1); a dotted name is an attachment.
const embedIsNote = (target) => !extOf(target) || extOf(target) === 'md'

function stripFrontmatter(markdown) {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
}

function collect(tokens, visit) {
  for (const token of tokens) {
    visit(token)
    if (token.tokens) collect(token.tokens, visit)
    if (token.items) collect(token.items, visit)
  }
}

function wikiExtension({ resolveLink }) {
  return {
    name: 'wikilink',
    level: 'inline',
    start(src) {
      return src.indexOf('[[')
    },
    tokenizer(src) {
      const match = /^\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/.exec(src)
      if (!match) return
      const target = match[1].trim()
      return {
        type: 'wikilink',
        raw: match[0],
        target,
        anchor: match[2]?.slice(1).trim() || '',
        display: match[3]?.trim() || target,
      }
    },
    renderer(token) {
      const path = resolveLink(token.target)
      const cls = path ? 'wikilink' : 'wikilink wikilink-unresolved'
      const attrs = [
        `class="${cls}"`,
        `data-wikilink="${esc(token.target)}"`,
        token.anchor ? `data-anchor="${esc(token.anchor)}"` : '',
        path ? `data-path="${esc(path)}"` : '',
        `title="${esc(path ?? 'Note not found')}"`,
      ].filter(Boolean)
      return `<a ${attrs.join(' ')}>${esc(token.display)}</a>`
    },
  }
}

function embedExtension({ resolveLink, resolveEmbed, urls }) {
  return {
    name: 'embed',
    level: 'inline',
    start(src) {
      return src.indexOf('![[')
    },
    tokenizer(src) {
      const match = /^!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(src)
      if (!match) return
      return {
        type: 'embed',
        raw: match[0],
        target: match[1].trim(),
        display: match[2]?.trim() || match[1].trim(),
      }
    },
    renderer(token) {
      const path = resolveEmbed(token.target)
      const url = path ? urls.get(path) : null
      const broken = `<span class="embed-missing" data-embed="${esc(token.target)}">![[${esc(token.target)}]]</span>`

      // v4.1: ![[Note]] is a link, not a transclusion.
      if (embedIsNote(token.target)) {
        const path = resolveLink(token.target.replace(/\.md$/i, ''))
        const attrs = `class="wikilink" data-wikilink="${esc(token.target.replace(/\.md$/i, ''))}"${
          path ? ` data-path="${esc(path)}"` : ''
        }`
        return `<a ${attrs}>${esc(token.display)}</a>`
      }
      if (!path || !url) return broken

      const name = path.split('/').pop()
      const image = IMAGE.has(extOf(name))
      if (image) {
        return `<img class="embed-image" data-embed="${esc(token.target)}" src="${url}" alt="${esc(token.display)}">`
      }
      return `<a class="embed-file" data-embed="${esc(token.target)}" href="${url}" download="${esc(name)}">${esc(token.display)}</a>`
    },
  }
}

function tagExtension() {
  return {
    name: 'tag',
    level: 'inline',
    start(src) {
      return src.indexOf('#')
    },
    tokenizer(src) {
      // Word-bounded so hex colors and URL fragments stay text. Numeric-only is not a tag.
      const match = /^#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/u.exec(src)
      if (!match) return
      return { type: 'tag', raw: match[0], tag: match[1] }
    },
    renderer(token) {
      return `<span class="tag" data-tag="${esc(token.tag)}" title="#${esc(token.tag)}">#${esc(token.tag)}</span>`
    },
  }
}

export async function render(markdown, { resolveLink = () => null, resolveEmbed = () => null, readEmbed = null } = {}) {
  const body = stripFrontmatter(markdown)
  const links = []
  const embeds = []
  const headings = []

  // Blob URLs are created before parsing because OPFS reads are async; the per-render
  // Set is revoked as a whole when the container is torn down (§6.4).
  const blobUrls = new Set()
  const urls = new Map()
  for (const match of body.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
    const target = match[1].trim()
    const path = resolveEmbed(target)
    if (!path || /\.md$/i.test(path) || urls.has(path) || !readEmbed) continue
    const blob = await Promise.resolve(readEmbed(path)).catch(() => null)
    if (!blob) continue
    const url = URL.createObjectURL(blob)
    urls.set(path, url)
    blobUrls.add(url)
  }

  const md = new Marked({ gfm: true })
  md.use({
    extensions: [
      embedExtension({ resolveLink, resolveEmbed, urls }),
      wikiExtension({ resolveLink }),
      tagExtension(),
    ],
  })

  const tokens = md.lexer(body)
  collect(tokens, (token) => {
    if (token.type === 'heading') {
      headings.push({ depth: token.depth, text: token.text })
    } else if (token.type === 'wikilink') {
      links.push({ target: token.target, display: token.display, path: resolveLink(token.target), anchor: token.anchor })
    } else if (token.type === 'embed') {
      const path = resolveEmbed(token.target)
      const note = embedIsNote(token.target)
      embeds.push({
        target: token.target,
        path: note ? resolveLink(token.target.replace(/\.md$/i, '')) : path,
        missing: note ? false : !path || !urls.has(path),
      })
    }
  })

  const html = DOMPurify.sanitize(md.parser(tokens), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: true,
    // DOMPurify's default drops blob: because the scheme is followed by a letter (§6.4).
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|blob|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  })

  let revoked = false
  return {
    html,
    links,
    embeds,
    headings,
    revoke() {
      if (revoked) return
      revoked = true
      for (const url of blobUrls) URL.revokeObjectURL(url)
      blobUrls.clear()
      urls.clear()
    },
  }
}
