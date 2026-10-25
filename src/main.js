import './app-shell.css'
import { version } from '../package.json'
import { installDebugLog } from './debug-log.js'
import { createEditor } from './editor.js'
import { FileModel } from './file-model.js'
import { createFileTree } from './file-tree.js'
import { createResolver } from './links.js'
import { render } from './render.js'

installDebugLog()
document.getElementById('app').dataset.ready = 'true'
document.getElementById('version').textContent = `v${version}`

// shortcut: active vault is a scalar in localStorage until VaultManager lands; no creation UI yet.
const vaultId = localStorage.getItem('activeVaultId') || 'default'
const model = new FileModel(vaultId)

const emptyEl = document.getElementById('editor-empty')
const hostEl = document.getElementById('editor')
const previewEl = document.getElementById('preview')
const pathEl = document.getElementById('status-path')
const saveEl = document.getElementById('save-state')
const renameButton = document.getElementById('rename-note')
const deleteButton = document.getElementById('delete-note')
const modeButton = document.getElementById('toggle-preview')

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

document.addEventListener('note-saved', (event) => {
  if (event.detail.path === current) setSaveState('Saved')
})

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
  const resolveLink = createResolver(paths, current, 'note')
  const resolveEmbed = createResolver(paths, current, 'file')
  const result = await render(editor.getContent(), {
    resolveLink,
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
  current = target
  pathEl.textContent = current
  await tree.refresh()
  tree.setCurrent(current)
}

async function deleteCurrent() {
  if (!current) return
  if (!window.confirm(`Move "${titleOf(current)}" to trash?`)) return
  await model.deleteNote(current)
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
    if (link.dataset.path) return open(link.dataset.path)
    const target = link.dataset.wikilink.replace(/^\/+/, '').trim()
    if (!target || !window.confirm(`Create "${target}"?`)) return
    const path = /\.md$/i.test(target) ? target : `${target}.md`
    try {
      await model.createNote(path, '')
    } catch {
      window.alert('That path is not a valid note name.')
      return
    }
    await tree.refresh()
    return open(path)
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
tree.refresh()

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      // A failed SW must never block the app (§21: continue with the old shell).
      console.warn('Service worker registration failed', error)
    })
  })
}
