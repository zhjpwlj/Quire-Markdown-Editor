// Sidebar file tree. Folders expand in place; each folder row can create a note inside it.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const titleOf = (path) => path.split('/').pop().replace(/\.md$/, '')

export function createFileTree({ onOpen, onNewNoteIn, load }) {
  const root = document.getElementById('note-list')
  const expanded = new Set()
  let current = null
  let notes = []
  let folders = []

  function render() {
    const byFolder = new Map()
    const folderFor = (path) => {
      let node = byFolder.get(path)
      if (!node) {
        node = { folders: new Set(), notes: [] }
        byFolder.set(path, node)
      }
      return node
    }

    const parentOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
    const ensureFolder = (path) => {
      if (!byFolder.has(path)) {
        byFolder.set(path, { folders: new Set(), notes: [] })
        const parent = parentOf(path)
        // The root's parent is itself; recursing there would nest '' under itself.
        if (parent !== path) ensureFolder(parent).folders.add(path)
      }
      return byFolder.get(path)
    }

    for (const folder of folders) ensureFolder(folder)
    for (const note of notes) folderFor(parentOf(note.path)).notes.push(note)

    const level = (container, path, depth) => {
      const node = byFolder.get(path) ?? { folders: new Set(), notes: [] }
      const pad = 8 + depth * 12

      for (const folder of [...node.folders].sort(collator.compare)) {
        const name = folder.split('/').pop()
        const open = expanded.has(folder)

        const row = document.createElement('div')
        row.className = 'tree-row'

        const toggle = document.createElement('button')
        toggle.type = 'button'
        toggle.className = 'tree-folder'
        toggle.style.paddingLeft = `${pad}px`
        toggle.setAttribute('aria-expanded', String(open))
        toggle.textContent = `${open ? '▾' : '▸'} ${name}`
        toggle.addEventListener('click', () => {
          if (open) expanded.delete(folder)
          else expanded.add(folder)
          render()
        })

        const add = document.createElement('button')
        add.type = 'button'
        add.className = 'tree-add'
        add.textContent = '+'
        add.title = `New note in ${name}`
        add.setAttribute('aria-label', `New note in ${name}`)
        add.addEventListener('click', () => onNewNoteIn(folder))

        row.append(toggle, add)
        container.append(row)
        if (open) level(container, folder, depth + 1)
      }

      for (const note of [...node.notes].sort((a, b) => collator.compare(titleOf(a.path), titleOf(b.path)))) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'tree-note'
        button.style.paddingLeft = `${pad + 14}px`
        button.textContent = titleOf(note.path)
        button.dataset.path = note.path
        if (note.path === current) button.setAttribute('aria-current', 'true')
        button.addEventListener('click', () => onOpen(note.path))
        container.append(button)
      }
    }

    root.replaceChildren()
    level(root, '', 0)
  }

  return {
    async refresh() {
      ;[notes, folders] = await Promise.all([load.notes(), load.folders()])
      render()
    },
    setCurrent(path) {
      current = path
      if (path) {
        // Open the containing folders so the active note is never hidden.
        const parts = path.split('/').slice(0, -1)
        for (let i = 1; i <= parts.length; i++) expanded.add(parts.slice(0, i).join('/'))
      }
      render()
    },
  }
}
