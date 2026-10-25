import './app-shell.css'
import { version } from '../package.json'
import { installDebugLog } from './debug-log.js'
import { createEditor } from './editor.js'
import { FileModel } from './file-model.js'

installDebugLog()
document.getElementById('app').dataset.ready = 'true'
document.getElementById('version').textContent = `v${version}`

// shortcut: active vault is a scalar in localStorage until VaultManager lands; no creation UI yet.
const vaultId = localStorage.getItem('activeVaultId') || 'default'
const model = new FileModel(vaultId)

const listEl = document.getElementById('note-list')
const emptyEl = document.getElementById('editor-empty')
const hostEl = document.getElementById('editor')
const pathEl = document.getElementById('status-path')
const saveEl = document.getElementById('save-state')

let current = null

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

const titleOf = (path) => path.split('/').pop().replace(/\.md$/, '')
const setSaveState = (text) => {
  saveEl.textContent = text
}

document.addEventListener('note-saved', (event) => {
  if (event.detail.path === current) setSaveState('Saved')
})

async function refresh() {
  const notes = await model.listNotes()
  listEl.replaceChildren(
    ...notes.map(({ path }) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = titleOf(path)
      button.dataset.path = path
      if (path === current) button.setAttribute('aria-current', 'true')
      button.addEventListener('click', () => open(path))
      return button
    }),
  )
  emptyEl.hidden = current !== null
}

async function open(path) {
  await model.flush()
  const content = await model.readNote(path)
  current = path
  editor.load(content)
  pathEl.textContent = path
  emptyEl.hidden = true
  hostEl.hidden = false
  setSaveState('Saved')
  await refresh()
  editor.focus()
}

async function createNote() {
  const taken = new Set((await model.listNotes()).map((note) => note.path))
  let path = 'Untitled.md'
  for (let i = 2; taken.has(path); i++) path = `Untitled ${i}.md`
  await model.createNote(path, '')
  await open(path)
}

document.getElementById('new-note').addEventListener('click', createNote)

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') model.flush()
})
window.addEventListener('pagehide', () => model.flush())

refresh()

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      // A failed SW must never block the app (§21: continue with the old shell).
      console.warn('Service worker registration failed', error)
    })
  })
}
