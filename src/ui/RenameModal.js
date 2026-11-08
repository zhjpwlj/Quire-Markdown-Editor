import { openConfirmModal, openFormModal } from './modal.js'
import { validateName } from '../vault/rename.js'

const noteNameError = (value) => validateName(value) ?? (/\.md$/i.test(value) ? null : 'Notes must end in .md')

export function askRename(currentName, { kind = 'file' } = {}) {
  return openFormModal({
    title: kind === 'folder' ? 'Rename folder' : 'Rename note',
    label: kind === 'folder' ? 'Folder name' : 'File name',
    value: currentName,
    confirmLabel: 'Rename',
    validate: (value) => (kind === 'folder' ? validateName(value) : noteNameError(value)),
  })
}

export function askLinkRewrite(count) {
  return openConfirmModal({
    title: 'Update links?',
    message: `Rename will update ${count} notes' links. Continue?`,
    confirmLabel: 'Rename',
  })
}
