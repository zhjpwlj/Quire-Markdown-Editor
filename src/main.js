import './app-shell.css'

// Shell only: no storage, no editor, no auth yet (Milestone 1).
document.getElementById('app').dataset.ready = 'true'

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      // A failed SW must never block the app (§21: continue with the old shell).
      console.warn('Service worker registration failed', error)
    })
  })
}
