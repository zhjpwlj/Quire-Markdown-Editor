// Link resolution (§10.2): exact path, case-insensitive filename, then closest to the
// note (same folder, then shallowest). When two candidates remain, the first is returned
// with ambiguous: true so the UI can show a disambiguation popover instead of guessing.
export function createResolverDetailed(paths, currentPath = '', kind = 'note') {
  const lower = (value) => value.toLowerCase()
  const folder = currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/')) : ''

  return (target) => {
    const clean = target.replace(/^\/+/, '').trim()
    if (!clean) return { path: null, ambiguous: false, candidates: [] }
    // Notes get .md appended; attachments are referenced by their real filename.
    const wanted = kind === 'note' && !/\.md$/i.test(clean) ? `${clean}.md` : clean

    if (paths.includes(wanted)) return { path: wanted, ambiguous: false, candidates: [wanted] }

    const base = lower(wanted.split('/').pop())
    let candidates = paths.filter((path) => lower(path.split('/').pop()) === base)
    if (candidates.length === 0) return { path: null, ambiguous: false, candidates: [] }

    if (folder) {
      const sameFolder = `${folder}/${wanted.split('/').pop()}`
      if (candidates.includes(sameFolder)) {
        return { path: sameFolder, ambiguous: false, candidates: [sameFolder] }
      }
    }

    candidates = [...candidates].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    return { path: candidates[0], ambiguous: candidates.length > 1, candidates }
  }
}

export function createResolver(paths, currentPath = '', kind = 'note') {
  const resolve = createResolverDetailed(paths, currentPath, kind)
  return (target) => resolve(target).path
}
