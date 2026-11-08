// Tree render + pointer-based drag and drop. HTML5 DnD is not used: it is unreliable on iOS.
const natural = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

function compare(a, b) {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
  return natural(a, b)
}

export function buildTree(entries) {
  const root = { path: '', name: '', kind: 'folder', children: [] }
  const folders = new Map([['', root]])

  const ensureFolder = (path) => {
    if (folders.has(path)) return folders.get(path)
    const slash = path.lastIndexOf('/')
    const parentPath = slash === -1 ? '' : path.slice(0, slash)
    const node = { path, name: slash === -1 ? path : path.slice(slash + 1), kind: 'folder', children: [] }
    folders.set(path, node)
    ensureFolder(parentPath).children.push(node)
    return node
  }

  for (const entry of entries) {
    if (entry.kind === 'folder') {
      ensureFolder(entry.path)
    } else {
      const parentPath = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : ''
      ensureFolder(parentPath).children.push({ path: entry.path, name: entry.name, kind: 'file', children: [] })
    }
  }

  const sort = (node) => {
    node.children.sort(compare)
    for (const child of node.children) if (child.kind === 'folder') sort(child)
  }
  sort(root)
  return root
}

let dragging = null
let suppressClick = false

function rowElement(node, depth, options) {
  const row = document.createElement('div')
  row.className = 'tree-row'
  row.dataset.path = node.path
  row.dataset.kind = node.kind
  row.setAttribute('role', 'treeitem')
  row.tabIndex = 0
  row.style.paddingLeft = `${8 + depth * 14}px`
  if (options.activePath === node.path) row.classList.add('is-active')

  const twisty = Object.assign(document.createElement('span'), {
    className: 'tree-twisty',
    textContent: node.kind === 'folder' ? (options.expanded.has(node.path) ? '▾' : '▸') : '',
    'aria-hidden': 'true',
  })
  const label = Object.assign(document.createElement('span'), { className: 'tree-label', textContent: node.name })
  row.append(twisty, label)

  row.addEventListener('click', () => {
    if (suppressClick) {
      suppressClick = false
      return
    }
    if (node.kind === 'folder') options.onToggle(node.path)
    else options.onOpen(node.path)
  })
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (node.kind === 'folder') options.onToggle(node.path)
      else options.onOpen(node.path)
    }
  })
  row.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    options.onContext(node, event.clientX, event.clientY)
  })

  if (node.kind === 'file') startPointerDrag(row, node, options)
  return row
}

function startPointerDrag(row, node, options) {
  row.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.pointerType === 'mouse' && event.buttons !== 1) return
    dragging = { node, options, startX: event.clientX, startY: event.clientY, ghost: null, target: null }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp, { once: true })
  })
}

function ghostAt(x, y) {
  const ghost = Object.assign(document.createElement('div'), {
    className: 'drag-ghost',
    textContent: dragging.node.name,
  })
  ghost.style.left = `${x + 12}px`
  ghost.style.top = `${y + 12}px`
  document.body.append(ghost)
  return ghost
}

function folderUnder(x, y) {
  const row = document.elementFromPoint(x, y)?.closest?.('.tree-row')
  return row?.dataset.kind === 'folder' ? row : null
}

function highlight(row) {
  if (dragging.target === row) return
  dragging.target?.classList.remove('drop-target')
  dragging.target = row
  row?.classList.add('drop-target')
}

function onMove(event) {
  if (!dragging) return
  const dx = event.clientX - dragging.startX
  const dy = event.clientY - dragging.startY
  if (!dragging.ghost) {
    if (Math.hypot(dx, dy) < 8) return
    dragging.ghost = ghostAt(event.clientX, event.clientY)
  }
  event.preventDefault()
  dragging.ghost.style.left = `${event.clientX + 12}px`
  dragging.ghost.style.top = `${event.clientY + 12}px`
  highlight(folderUnder(event.clientX, event.clientY))
}

function onUp(event) {
  document.removeEventListener('pointermove', onMove)
  if (!dragging) return
  const { node, ghost, target, options } = dragging
  ghost?.remove()
  target?.classList.remove('drop-target')
  dragging = null

  if (!ghost) return
  // Suppress the click that follows a completed drag; clear it if no click arrives.
  suppressClick = true
  setTimeout(() => {
    suppressClick = false
  }, 0)

  const folder = folderUnder(event.clientX, event.clientY)
  if (!folder) return
  const parent = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : ''
  // Dropping onto another file, or the current folder, is a no-op.
  if (folder.dataset.path !== parent) options.onMove(node.path, folder.dataset.path)
}

export function renderTree(container, root, options) {
  const level = (node, depth) => {
    const nodes = []
    for (const child of node.children) {
      nodes.push(rowElement(child, depth, options))
      if (child.kind !== 'folder' || !options.expanded.has(child.path)) continue
      if (child.children.length === 0) {
        const empty = Object.assign(document.createElement('div'), {
          className: 'tree-empty',
          textContent: 'This folder is empty.',
        })
        empty.style.paddingLeft = `${8 + (depth + 1) * 14}px`
        nodes.push(empty)
      } else {
        nodes.push(...level(child, depth + 1))
      }
    }
    return nodes
  }

  container.replaceChildren(Object.assign(document.createElement('div'), { className: 'tree', role: 'tree' }))
  container.firstChild.append(...level(root, 0))
  if (root.children.length === 0) {
    container.firstChild.append(Object.assign(document.createElement('p'), {
      className: 'tree-empty-root',
      textContent: 'No notes yet.',
    }))
  }
}
