import { openFormModal } from './modal.js'
import { validateName } from '../vault/rename.js'

export function askNewName(kind = 'note') {
  const folder = kind === 'folder'
  return openFormModal({
    title: folder ? 'New folder' : 'New note',
    label: folder ? 'Folder name' : 'File name',
    value: folder ? '' : 'Untitled.md',
    placeholder: folder ? 'Projects' : 'Untitled.md',
    confirmLabel: 'Create',
    validate: (value) => {
      const reason = validateName(value)
      if (reason) return reason
      return !folder && !/\.md$/i.test(value) ? 'Notes must end in .md' : null
    },
  })
}
