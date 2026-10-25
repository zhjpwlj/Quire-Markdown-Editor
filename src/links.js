// Temporary resolver for render and embed targets. LinkIndex (§6.5, M6) replaces it;
// order matches §10.2: exact path, case-insensitive filename, then closest to the note.
export function createResolver(paths, currentPath = '', kind = 'note') {
  const lower = (value) => value.toLowerCase()
  const folder = currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/')) : ''

  return (target) => {
    const clean = target.replace(/^\/+/, '').trim()
    if (!clean) return null
    // Notes get .md appended; attachments are referenced by their real filename.
    const wanted = kind === 'note' && !/\.md$/i.test(clean) ? `${clean}.md` : clean

    if (paths.includes(wanted)) return wanted

    const base = lower(wanted.split('/').pop())
    const candidates = paths.filter((path) => lower(path.split('/').pop()) === base)
    if (candidates.length === 0) return null

    if (folder) {
      const sameFolder = `${folder}/${wanted.split('/').pop()}`
      if (candidates.includes(sameFolder)) return sameFolder
    }

    return [...candidates].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0]
  }
}
