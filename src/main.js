import './app-shell.css'
import { installDebugLog } from './debug-log.js'
import * as opfs from './storage/opfs.js'
import * as trash from './storage/trash.js'
import * as vault from './vault/VaultManager.js'
import { FileModel } from './vault/FileModel.js'
import { EditorController } from './editor/EditorController.js'

document.getElementById('app').dataset.ready = 'true'
installDebugLog()

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      // A failed SW must never block the app (§21: continue with the old shell).
      console.warn('Service worker registration failed', error)
    })
  })
}

// shortcut: internal handle for e2e tests and scripts/seed-vault.mjs; remove before 1.0.
// `ready` matters: init() is async, and callers must not read vault state before it settles.
window.__quire = { opfs, trash, vault, fileModel: null, editor: null, openNote: null, ready: null }

const vaultName = document.getElementById('vault-name')
const statusbar = document.querySelector('.statusbar span')
const editorPane = document.querySelector('.editor-pane')
const emptyState = document.querySelector('.editor-empty')

const editorHost = document.createElement('div')
editorHost.className = 'editor-host'
editorHost.hidden = true
editorPane.append(editorHost)

let fileModel = null
let controller = null
let currentPath = null

function showEmpty({ heading, body, action, onAction }) {
  editorHost.hidden = true
  emptyState.hidden = false
  const button = Object.assign(document.createElement('button'), {
    type: 'button',
    className: 'primary-button',
    textContent: action,
  })
  button.addEventListener('click', async () => {
    button.disabled = true
    try {
      await onAction()
    } catch (error) {
      button.disabled = false
      throw error
    }
  })
  emptyState.replaceChildren(
    Object.assign(document.createElement('h1'), { textContent: heading }),
    Object.assign(document.createElement('p'), { textContent: body }),
    button,
  )
}

async function openNote(path) {
  const note = await fileModel.readNote(path)
  if (!note) return null
  currentPath = path
  emptyState.hidden = true
  editorHost.hidden = false
  controller ??= new EditorController(editorHost, {
    onChange: (content) => {
      if (currentPath) fileModel.writeNote(currentPath, content)
    },
  })
  controller.load(note.content, path)
  controller.focus()
  statusbar.textContent = path
  return note
}

async function openVault(record) {
  vaultName.textContent = record.name
  fileModel = new FileModel(record.id)
  window.__quire.fileModel = fileModel
  currentPath = null

  const notes = await fileModel.listNotes()
  if (notes.length) {
    await openNote(notes[0].path)
    return
  }

  showEmpty({
    heading: 'No notes yet',
    body: 'Notes are markdown files on this device.',
    action: 'New note',
    onAction: async () => {
      await fileModel.createNote('untitled.md', '# Untitled\n')
      await openNote('untitled.md')
    },
  })
}

function renderFirstRun() {
  vaultName.textContent = 'No vault open'
  showEmpty({
    heading: 'Quire',
    body: 'Local-first markdown notes that sync to your cloud.',
    action: 'Create “My Notes”',
    onAction: async () => {
      const record = await vault.createVault({ name: 'My Notes' })
      await openVault(record)
    },
  })
}

async function boot() {
  await vault.init()
  const active = vault.getActiveVault()
  if (active) await openVault(active)
  else renderFirstRun()
}

window.__quire.openNote = (path) => openNote(path)
window.__quire.editor = () => controller
window.__quire.ready = boot().catch((error) => {
  console.error('boot failed', error)
  vaultName.textContent = 'Storage unavailable'
})
