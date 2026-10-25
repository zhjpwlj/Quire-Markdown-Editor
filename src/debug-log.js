// On-device debug log. Long-press the app title for 1s to open it — iOS has no console.
const MAX_ENTRIES = 200
const entries = []
let panel = null

function format(value) {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack || value.message
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function record(level, values) {
  entries.push(`${new Date().toISOString().slice(11, 23)} ${level} ${values.map(format).join(' ')}`)
  if (entries.length > MAX_ENTRIES) entries.shift()
  if (panel) panel.body.textContent = entries.join('\n')
}

function snapshotEnvironment() {
  record('env', [
    `ua=${navigator.userAgent}`,
    `viewport=${innerWidth}x${innerHeight}`,
    `mode=${document.getElementById('app')?.dataset.mode ?? '?'}`,
    `sw=${navigator.serviceWorker?.controller?.scriptURL ?? 'none'}`,
  ])
}

function open() {
  if (panel) return
  snapshotEnvironment()

  const root = document.createElement('div')
  root.className = 'debug-log'
  root.setAttribute('role', 'log')
  root.setAttribute('aria-label', 'Debug log')

  const head = document.createElement('div')
  head.className = 'debug-log-head'
  head.textContent = 'Debug'

  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'debug-log-close'
  closeButton.textContent = 'Close'
  closeButton.addEventListener('click', close)

  const body = document.createElement('pre')
  body.className = 'debug-log-body'
  body.textContent = entries.join('\n')

  head.append(closeButton)
  root.append(head, body)
  document.body.append(root)
  panel = { root, body }
}

function close() {
  panel?.root.remove()
  panel = null
}

function toggle() {
  if (panel) close()
  else open()
}

for (const level of ['log', 'info', 'warn', 'error']) {
  const original = console[level]
  console[level] = (...values) => {
    record(level, values)
    original.apply(console, values)
  }
}

window.addEventListener('error', (event) => record('error', [event.message]))
window.addEventListener('unhandledrejection', (event) => record('reject', [event.reason]))

export function installDebugLog(holdMs = 1000) {
  const trigger = document.querySelector('.app-name')
  if (!trigger) return

  let timer = 0
  const cancel = () => clearTimeout(timer)
  trigger.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    cancel()
    timer = setTimeout(toggle, holdMs)
  })
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) trigger.addEventListener(type, cancel)
  trigger.addEventListener('contextmenu', (event) => event.preventDefault())
}
