import DOMPurify from 'dompurify'

// Explicit whitelist, not DOMPurify's default (which allows <style>, §M5).
export const ALLOWED_TAGS = [
  'a', 'p', 'br', 'em', 'strong', 'del', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
  'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'sup', 'sub',
]

export const ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title', 'class', 'id', 'download',
  'data-wikilink', 'data-anchor', 'data-embed', 'data-heading-id',
  'colspan', 'rowspan', 'start', 'align',
]

// blob: is missing from DOMPurify's default URI regexp; embeds need it.
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i

export const PURIFY_CONFIG = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  // Only the three data-* attributes above survive.
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP,
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'button', 'link', 'meta'],
  FORBID_ATTR: ['style', 'srcdoc'],
  RETURN_TRUSTED_TYPE: false,
  KEEP_CONTENT: true,
}

export function sanitize(html) {
  return DOMPurify.sanitize(html, PURIFY_CONFIG)
}
