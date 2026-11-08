// Interface only for M4. M6 supplies the real index; rename.js already consumes this shape.
export const LinkIndex = {
  // DECISION: Link rewriting lands M6.
  getIncoming(_path) {
    return []
  },
}
