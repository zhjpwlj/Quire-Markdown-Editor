// Minimal promise-based modals. No framework, no focus trap yet (M30a owns a11y polish).
function overlay({ title, children }) {
  const root = document.createElement('div')
  root.className = 'modal-overlay'
  const box = document.createElement('div')
  box.className = 'modal'
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-modal', 'true')
  box.setAttribute('aria-label', title)
  box.append(Object.assign(document.createElement('h2'), { className: 'modal-title', textContent: title }))
  box.append(...children)
  root.append(box)
  document.body.append(root)
  return { root, box }
}

export function openFormModal({ title, label, value = '', placeholder = '', confirmLabel = 'Save', message = '', validate }) {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { className: 'modal-input', value, placeholder })
    input.id = 'modal-input'
    const inputLabel = Object.assign(document.createElement('label'), { className: 'modal-label', htmlFor: input.id, textContent: label })
    const error = Object.assign(document.createElement('p'), { className: 'modal-error', role: 'alert' })
    const messageText = Object.assign(document.createElement('p'), { className: 'modal-message', textContent: message })
    const confirm = Object.assign(document.createElement('button'), { type: 'button', className: 'primary-button', textContent: confirmLabel })
    const cancel = Object.assign(document.createElement('button'), { type: 'button', className: 'secondary-button', textContent: 'Cancel' })
    const actions = Object.assign(document.createElement('div'), { className: 'modal-actions' }, {})
    actions.append(cancel, confirm)

    const { root, box } = overlay({ title, children: [messageText, inputLabel, input, error, actions] })

    const close = (result) => {
      root.remove()
      document.removeEventListener('keydown', onKey)
      resolve(result)
    }
    const submit = () => {
      const reason = validate?.(input.value)
      if (reason) {
        error.textContent = reason
        input.focus()
        return
      }
      close(input.value)
    }
    function onKey(event) {
      if (event.key === 'Escape') close(null)
      if (event.key === 'Enter' && event.target === input) submit()
    }

    confirm.addEventListener('click', submit)
    cancel.addEventListener('click', () => close(null))
    root.addEventListener('pointerdown', (event) => {
      if (event.target === root) close(null)
    })
    document.addEventListener('keydown', onKey)
    input.focus()
    input.select()
  })
}

export function openConfirmModal({ title, message, confirmLabel = 'Continue' }) {
  return new Promise((resolve) => {
    const messageText = Object.assign(document.createElement('p'), { className: 'modal-message', textContent: message })
    const confirm = Object.assign(document.createElement('button'), { type: 'button', className: 'primary-button', textContent: confirmLabel })
    const cancel = Object.assign(document.createElement('button'), { type: 'button', className: 'secondary-button', textContent: 'Cancel' })
    const actions = Object.assign(document.createElement('div'), { className: 'modal-actions' })
    actions.append(cancel, confirm)

    const { root } = overlay({ title, children: [messageText, actions] })
    const close = (result) => {
      root.remove()
      document.removeEventListener('keydown', onKey)
      resolve(result)
    }
    function onKey(event) {
      if (event.key === 'Escape') close(false)
      if (event.key === 'Enter') close(true)
    }

    confirm.addEventListener('click', () => close(true))
    cancel.addEventListener('click', () => close(false))
    root.addEventListener('pointerdown', (event) => {
      if (event.target === root) close(false)
    })
    document.addEventListener('keydown', onKey)
    confirm.focus()
  })
}
