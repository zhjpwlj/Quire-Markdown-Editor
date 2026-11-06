import './app-shell.css'
import { installDebugLog } from './debug-log.js'
import * as opfs from './storage/opfs.js'
import * as trash from './storage/trash.js'
import * as vault from './vault/VaultManager.js'

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
window.__quire = { opfs, trash, vault, ready: null }

const vaultName = document.getElementById('vault-name')
const emptyState = document.querySelector('.editor-empty')

function renderVault(record) {
  vaultName.textContent = record.name
  emptyState.replaceChildren(
    Object.assign(document.createElement('h1'), { textContent: 'Quire' }),
    Object.assign(document.createElement('p'), { textContent: 'Notes are stored on this device only.' }),
  )
}

function renderFirstRun() {
  vaultName.textContent = 'No vault open'
  const button = Object.assign(document.createElement('button'), {
    type: 'button',
    className: 'primary-button',
    textContent: 'Create “My Notes”',
  })
  button.addEventListener('click', async () => {
    button.disabled = true
    renderVault(await vault.createVault({ name: 'My Notes' }))
  })
  emptyState.replaceChildren(
    Object.assign(document.createElement('h1'), { textContent: 'Quire' }),
    Object.assign(document.createElement('p'), { textContent: 'Local-first markdown notes that sync to your cloud.' }),
    button,
  )
}

async function boot() {
  await vault.init()
  const active = vault.getActiveVault()
  if (active) renderVault(active)
  else renderFirstRun()
}

window.__quire.ready = boot().catch((error) => {
  console.error('boot failed', error)
  vaultName.textContent = 'Storage unavailable'
})
