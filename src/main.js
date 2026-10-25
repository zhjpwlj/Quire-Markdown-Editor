import './app-shell.css'
import { version } from '../package.json'
import { installDebugLog } from './debug-log.js'
import { createEditor } from './editor.js'
import { FileModel } from './file-model.js'
import { createFileTree } from './file-tree.js'

installDebugLog()
document.getElementById('app').dataset.ready = 'true'
document.getElementById('version').textContent = `v${version}`

// shortcut: active vault is a scalar in localStorage until VaultManager lands; no creation UI yet.
const vaultId = localStorage.getItem('activeVaultId') || 'default'
const model = new FileModel(vaultId)

const emptyEl = document.getElementById('editor-empty')
const hostEl = document.getElementById('editor')
const pathEl = document.getElementById('status-path')
const saveEl = document.getElementById('save-state')
const renameButton = document.getElementById('rename-note')
const deleteButton = document.getElementById('delete-note')

let current = null

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
  load: { notes: () => model.listNotes(), folders: () => model.listFolders() },
  onOpen: (path) => open(path),
  onNewNoteIn: (folder) => createNote(folder),
})

document.addEventListener('note-saved', (event) => {
  if (event.detail.path === current) setSaveState('Saved')
})

function showEmpty() {
  current = null
  pathEl.textContent = 'No note open'
  saveEl.textContent = ''
  hostEl.hidden = true
  emptyEl.hidden = false
  renameButton.disabled = true
  deleteButton.disabled = true
  tree.setCurrent(null)
}

async function open(path) {
  await model.flush()
  const content = await model.readNote(path)
  current = path
  editor.load(content)
  pathEl.textContent = path
  emptyEl.hidden = true
  hostEl.hidden = false
  renameButton.disabled = false
  deleteButton.disabled = false
  setSaveState('Saved')
  tree.setCurrent(path)
  editor.focus()
}

async function createNote(folder = '') {
  const taken = new Set((await model.listNotes()).map((note) => note.path))
  let name = 'Untitled.md'
  for (let i = 2; taken.has(`${folder ? `${folder}/` : ''}${name}`); i++) name = `Untitled ${i}.md`
  const path = folder ? `${folder}/${name}` : name
  await model.createNote(path, '')
  await tree.refresh()
  await open(path)
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
