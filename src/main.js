import './app-shell.css'
import { version } from '../package.json'
import { installDebugLog } from './debug-log.js'
import { createEditor } from './editor.js'
import { FileModel } from './file-model.js'
import { createFileTree } from './file-tree.js'
import { LinkIndex } from './link-index.js'
import { createResolver } from './links.js'
import { render } from './render.js'

installDebugLog()
document.getElementById('app').dataset.ready = 'true'
document.getElementById('version').textContent = `v${version}`

// shortcut: active vault is a scalar in localStorage until VaultManager lands; no creation UI yet.
const vaultId = localStorage.getItem('activeVaultId') || 'default'
const model = new FileModel(vaultId)
const index = new LinkIndex({ listNotes: () => model.listNotes(), readNote: (path) => model.readNote(path) })

const emptyEl = document.getElementById('editor-empty')
const hostEl = document.getElementById('editor')
const previewEl = document.getElementById('preview')
const pathEl = document.getElementById('status-path')
const saveEl = document.getElementById('save-state')
const renameButton = document.getElementById('rename-note')
const deleteButton = document.getElementById('delete-note')
const modeButton = document.getElementById('toggle-preview')
const linksPanel = document.getElementById('links-panel')
const backlinksEl = document.getElementById('backlinks')
const outgoingEl = document.getElementById('outgoing')

let current = null
let mode = 'source'
let rendered = null
let renderToken = 0

const titleOf = (path) => path.split('/').pop().replace(/\.md$/, '')
const setSaveState = (text) => {
  saveEl.textContent = text
}

const editor = createEditor(hostEl, {
  onInput: (text) => {
    if (!current) return
    model.writeNote(current, text)
    setSaveState('Saving…')
  },
  onSave: () => {
    if (current) model.flushNote(current)
  },
})

const tree = createFileTree({
  // Attachments live in the vault too, but the note tree lists markdown only.
  load: {
    notes: async () => (await model.listNotes()).filter((note) => note.path.endsWith('.md')),
    folders: () => model.listFolders(),
  },
  onOpen: (path) => open(path),
  onNewNoteIn: (folder) => createNote(folder),
})

document.addEventListener('note-saved', async (event) => {
  if (event.detail.path === current) setSaveState('Saved')
  await index.update(event.detail.path, await model.readNote(event.detail.path))
  updateLinksPanel()
})

function linkItem(path, context) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'link-item'
  button.textContent = titleOf(path)
  button.addEventListener('click', () => open(path))
  if (!context) return button
  const detail = document.createElement('span')
  detail.className = 'link-context'
  detail.textContent = context
  button.append(detail)
  return button
}

function updateLinksPanel() {
  if (!current) {
    linksPanel.hidden = true
    return
  }
  linksPanel.hidden = false

  const backlinks = index.getBacklinks(current)
  backlinksEl.replaceChildren(
    ...(backlinks.length
      ? backlinks.flatMap(({ path, contexts }) => contexts.map((context) => linkItem(path, context)))
      : [emptyNote('No backlinks')]),
  )

  const outgoing = index.getOutgoing(current)
  outgoingEl.replaceChildren(
    ...(outgoing.length
      ? outgoing.map((link) => {
          if (!link.path) {
            const item = document.createElement('button')
            item.type = 'button'
            item.className = 'link-item link-unresolved'
            item.textContent = link.target
            item.addEventListener('click', () => createFromTarget(link.target))
            return item
          }
          if (link.ambiguous) {
            const item = document.createElement('button')
            item.type = 'button'
            item.className = 'link-item link-ambiguous'
            item.textContent = link.target
            item.title = 'Ambiguous link'
            item.addEventListener('click', (event) => showDisambiguation(event, link.target))
            return item
          }
          return linkItem(link.path)
        })
      : [emptyNote('No outgoing links')]),
  )
}

function emptyNote(text) {
  const span = document.createElement('span')
  span.className = 'link-empty'
  span.textContent = text
  return span
}

// §10.2: never guess between two equally close notes; let the user pick.
function showDisambiguation(event, target) {
  document.querySelector('.disambiguation')?.remove()
  const { candidates } = index.resolveLinkInfo(target, current)
  if (candidates.length === 0) return

  const menu = document.createElement('div')
  menu.className = 'disambiguation'
  menu.setAttribute('role', 'menu')
  for (const path of candidates) {
    const option = document.createElement('button')
    option.type = 'button'
    option.setAttribute('role', 'menuitem')
    option.textContent = path
    option.addEventListener('click', () => {
      menu.remove()
      open(path)
    })
    menu.append(option)
  }

  menu.style.left = `${Math.min(event.clientX, window.innerWidth - 280)}px`
  menu.style.top = `${Math.min(event.clientY + 4, window.innerHeight - 160)}px`
  document.body.append(menu)

  const close = (closeEvent) => {
    if (menu.contains(closeEvent.target)) return
    menu.remove()
    document.removeEventListener('click', close)
  }
  // Defer so the click that opened the menu does not close it immediately.
  setTimeout(() => document.addEventListener('click', close))
}

function showEmpty() {
  current = null
  mode = 'source'
  pathEl.textContent = 'No note open'
  saveEl.textContent = ''
  hostEl.hidden = true
  previewEl.hidden = true
  emptyEl.hidden = false
  renameButton.disabled = true
  deleteButton.disabled = true
  modeButton.disabled = true
  modeButton.textContent = 'Preview'
  modeButton.setAttribute('aria-pressed', 'false')
  linksPanel.hidden = true
  discardRender()
  tree.setCurrent(null)
}

function discardRender() {
  renderToken++
  rendered?.revoke()
  rendered = null
  previewEl.replaceChildren()
}

async function renderPreview() {
  if (!current) return
  const token = ++renderToken
  const paths = (await model.listNotes()).map((note) => note.path)
  const resolveEmbed = createResolver(paths, current, 'file')
  const result = await render(editor.getContent(), {
    resolveLink: (target) => index.resolveLink(target, current),
    resolveEmbed,
    readEmbed: (path) => (paths.includes(path) ? model.readBlob(path) : null),
  })

  // A slower render must never overwrite a newer note or a newer render.
  if (token !== renderToken) return result.revoke()
  rendered?.revoke()
  rendered = result
  previewEl.innerHTML = result.html
}

function setMode(next) {
  if (!current) return
  mode = next
  const preview = mode === 'preview'
  hostEl.hidden = preview
  previewEl.hidden = !preview
  emptyEl.hidden = true
  modeButton.textContent = preview ? 'Edit' : 'Preview'
  modeButton.setAttribute('aria-pressed', String(preview))
  if (preview) {
    renderPreview()
  } else {
    discardRender()
    editor.focus()
  }
}

async function open(path) {
  editor.setEditable(false)
  try {
    await model.flush()
    const content = await model.readNote(path)
    current = path
    editor.load(content)
    pathEl.textContent = path
    emptyEl.hidden = true
    modeButton.disabled = false
    renameButton.disabled = false
    deleteButton.disabled = false
    setSaveState('Saved')
    tree.setCurrent(path)
    updateLinksPanel()
  } finally {
    editor.setEditable(true)
  }
  if (mode === 'preview') await renderPreview()
  else {
    hostEl.hidden = false
    previewEl.hidden = true
    editor.focus()
  }
}

async function createNote(folder = '') {
  // Hold the editor read-only from the click until the new note is loaded, so
  // keystrokes cannot be appended to the note that is about to close.
  editor.setEditable(false)
  try {
    const taken = new Set((await model.listNotes()).map((note) => note.path))
    let name = 'Untitled.md'
    for (let i = 2; taken.has(`${folder ? `${folder}/` : ''}${name}`); i++) name = `Untitled ${i}.md`
    const path = folder ? `${folder}/${name}` : name
    await model.createNote(path, '')
    await index.rebuild()
    await tree.refresh()
    await open(path)
  } finally {
    editor.setEditable(true)
  }
}

async function createFolder() {
  const input = window.prompt('Folder name')
  if (input === null) return
  const name = input.trim()
  if (!name || /[/\\]/.test(name)) {
    window.alert('Use a name without slashes.')
    return
  }
  await model.createFolder(name)
  await tree.refresh()
}

async function renameCurrent() {
  if (!current) return
  const input = window.prompt('Rename note', titleOf(current))
  if (input === null) return
  const name = input.trim().replace(/\.md$/i, '')
  if (!name || /[/\\]/.test(name)) {
    window.alert('Use a name without slashes.')
    return
  }

  const folder = current.includes('/') ? current.slice(0, current.lastIndexOf('/') + 1) : ''
  const target = `${folder}${name}.md`
  if (target === current) return
  if ((await model.listNotes()).some((note) => note.path.toLowerCase() === target.toLowerCase())) {
    window.alert('A note with that name already exists.')
    return
  }

  await model.renameNote(current, target)
  await index.rebuild()
  current = target
  pathEl.textContent = current
  await tree.refresh()
  tree.setCurrent(current)
  updateLinksPanel()
}

async function createFromTarget(target) {
  const clean = target.replace(/^\/+/, '').trim()
  if (!clean || !window.confirm(`Create "${clean}"?`)) return
  const path = /\.md$/i.test(clean) ? clean : `${clean}.md`
  editor.setEditable(false)
  try {
    await model.createNote(path, '')
    await index.rebuild()
    await tree.refresh()
    await open(path)
  } catch {
    window.alert('That path is not a valid note name.')
  } finally {
    editor.setEditable(true)
  }
}

async function deleteCurrent() {
  if (!current) return
  if (!window.confirm(`Move "${titleOf(current)}" to trash?`)) return
  await model.deleteNote(current)
  await index.rebuild()
  await tree.refresh()
  showEmpty()
}

document.getElementById('new-note').addEventListener('click', () => createNote())
document.getElementById('new-folder').addEventListener('click', createFolder)
renameButton.addEventListener('click', renameCurrent)
deleteButton.addEventListener('click', deleteCurrent)
modeButton.addEventListener('click', () => setMode(mode === 'preview' ? 'source' : 'preview'))

window.addEventListener('keydown', (event) => {
  // event.code, not key: layouts that move the letter still toggle (§12).
  if (event.code === 'KeyP' && event.altKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault()
    setMode(mode === 'preview' ? 'source' : 'preview')
  }
})

previewEl.addEventListener('click', async (event) => {
  const link = event.target.closest('[data-wikilink]')
  if (link) {
    if (link.dataset.ambiguous === 'true') {
      event.stopPropagation()
      return showDisambiguation(event, link.dataset.wikilink)
    }
    if (link.dataset.path) return open(link.dataset.path)
    return createFromTarget(link.dataset.wikilink)
  }

  if (event.target.closest('.embed-missing')) {
    window.alert('Attachment upload lands with the attachments milestone.')
  }
})

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') model.flush()
})
window.addEventListener('pagehide', () => model.flush())

showEmpty()

async function init() {
  await index.rebuild()
  await tree.refresh()
}
init()

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      // A failed SW must never block the app (§21: continue with the old shell).
      console.warn('Service worker registration failed', error)
    })
  })
}
