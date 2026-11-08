import './app-shell.css'
import { installDebugLog } from './debug-log.js'
import * as opfs from './storage/opfs.js'
import * as trash from './storage/trash.js'
import * as vault from './vault/VaultManager.js'
import { FileModel } from './vault/FileModel.js'
import { renameEntry, validateName } from './vault/rename.js'
import { LinkIndex } from './index/LinkIndex.js'
import { EditorController } from './editor/EditorController.js'
import { Sidebar } from './ui/Sidebar.js'
import { askRename, askLinkRewrite } from './ui/RenameModal.js'
import { askNewName } from './ui/NewNoteModal.js'

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

const join = (...parts) => parts.filter(Boolean).join('/')
const parentOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
const nameOf = (path) => path.slice(path.lastIndexOf('/') + 1)

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

function reportError(error) {
  console.error(error)
  window.alert(error.message ?? String(error))
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
  sidebar.setActive(path)
  return note
}

function showNothingToOpen() {
  currentPath = null
  showEmpty({
    heading: 'No notes yet',
    body: 'Notes are markdown files on this device.',
    action: 'New note',
    onAction: () => createNoteIn(''),
  })
}

async function createNoteIn(folder) {
  const name = await askNewName('note')
  if (!name) return
  const path = join(folder, name)
  try {
    await fileModel.createNote(path, `# ${name.replace(/\.md$/i, '')}\n`)
  } catch (error) {
    reportError(error)
    return
  }
  if (folder) sidebar.expand(folder)
  await sidebar.refresh()
  await openNote(path)
}

async function createFolderIn(folder) {
  const name = await askNewName('folder')
  if (!name) return
  const path = join(folder, name)
  try {
    await fileModel.createFolder(path)
  } catch (error) {
    reportError(error)
    return
  }
  sidebar.expand(path)
  await sidebar.refresh()
}

async function moveEntry(path, folder) {
  const to = join(folder, nameOf(path))
  try {
    const result = await renameEntry(fileModel, path, to, { confirm: (count) => askLinkRewrite(count) })
    if (!result.renamed) return
  } catch (error) {
    reportError(error)
    return
  }
  await sidebar.refresh()
  if (currentPath === path) await openNote(to)
}

async function renameNode(node) {
  const kind = node.kind
  const current = nameOf(node.path)
  const name = await askRename(current, { kind })
  if (!name || name === current) return

  const to = join(parentOf(node.path), name)
  try {
    const result = await renameEntry(fileModel, node.path, to, {
      kind,
      confirm: (count) => askLinkRewrite(count),
    })
    if (!result.renamed) return
  } catch (error) {
    reportError(error)
    return
  }

  if (kind === 'folder' && sidebar.expanded.delete(node.path)) sidebar.expanded.add(to)
  await sidebar.refresh()
  if (currentPath === node.path) await openNote(to)
  else if (currentPath?.startsWith(`${node.path}/`)) await openNote(join(to, currentPath.slice(node.path.length + 1)))
}

async function deleteNode(node) {
  try {
    if (node.kind === 'folder') await fileModel.deleteFolder(node.path)
    else await fileModel.deleteNote(node.path)
  } catch (error) {
    reportError(error)
    return
  }

  const removedOpenNote = currentPath === node.path || currentPath?.startsWith(`${node.path}/`)
  await sidebar.refresh()
  if (!removedOpenNote) return

  currentPath = null
  const notes = await fileModel.listNotes()
  if (notes.length) await openNote(notes[0].path)
  else showNothingToOpen()
}

async function duplicateNode(path) {
  try {
    await fileModel.duplicateNote(path)
  } catch (error) {
    reportError(error)
    return
  }
  await sidebar.refresh()
}

const sidebar = new Sidebar(document.querySelector('.sidebar'), {
  onOpen: (path) => void openNote(path),
  onNewNote: (folder) => void createNoteIn(folder),
  onNewFolder: (folder) => void createFolderIn(folder),
  onRename: (node) => void renameNode(node),
  onDelete: (node) => void deleteNode(node),
  onDuplicate: (path) => void duplicateNode(path),
  onMove: (path, folder) => void moveEntry(path, folder),
})

async function openVault(record) {
  vaultName.textContent = record.name
  fileModel = new FileModel(record.id)
  window.__quire.fileModel = fileModel
  currentPath = null
  await sidebar.setFileModel(fileModel)

  const notes = await fileModel.listNotes()
  if (notes.length) await openNote(notes[0].path)
  else showNothingToOpen()
}

function renderFirstRun() {
  vaultName.textContent = 'No vault open'
  sidebar.clear()
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

// shortcut: internal handle for e2e tests and scripts/seed-vault.mjs; remove before 1.0.
window.__quire = {
  opfs,
  trash,
  vault,
  fileModel: null,
  LinkIndex,
  validateName,
  sidebar,
  openNote: (path) => openNote(path),
  refreshSidebar: () => sidebar.refresh(),
  editor: () => controller,
  ready: null,
}

window.__quire.ready = boot().catch((error) => {
  console.error('boot failed', error)
  vaultName.textContent = 'Storage unavailable'
})
