import { buildTree, renderTree } from './FileTree.js'

// Owns tree state (expanded folders, active row) and the context menu. The tree is re-read from
// FileModel on every refresh; nothing is cached across vault switches (§M3).
export class Sidebar {
  constructor(element, callbacks) {
    this.el = element
    this.callbacks = callbacks
    this.fileModel = null
    this.entries = []
    this.expanded = new Set()
    this.activePath = null
    this.menu = null
    this.onDocumentPointerDown = (event) => {
      if (this.menu && !this.menu.contains(event.target)) this.closeMenu()
    }
    document.addEventListener('pointerdown', this.onDocumentPointerDown)
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeMenu()
    })
  }

  async setFileModel(fileModel) {
    this.fileModel = fileModel
    this.entries = []
    this.expanded.clear()
    this.activePath = null
    await this.refresh()
  }

  clear() {
    this.fileModel = null
    this.entries = []
    this.expanded.clear()
    this.activePath = null
    this.render()
  }

  async refresh() {
    if (!this.fileModel) return
    this.entries = await this.fileModel.listTree()
    this.render()
  }

  setActive(path) {
    this.activePath = path
    this.render()
  }

  expand(path) {
    this.expanded.add(path)
  }

  toggle(path) {
    if (this.expanded.has(path)) this.expanded.delete(path)
    else this.expanded.add(path)
    this.render()
  }

  render() {
    renderTree(this.el, buildTree(this.entries), {
      expanded: this.expanded,
      activePath: this.activePath,
      onOpen: (path) => this.callbacks.onOpen(path),
      onToggle: (path) => this.toggle(path),
      onContext: (node, x, y) => this.openMenu(node, x, y),
      onMove: (path, folder) => this.callbacks.onMove(path, folder),
    })
  }

  closeMenu() {
    this.menu?.remove()
    this.menu = null
  }

  openMenu(node, x, y) {
    this.closeMenu()
    const menu = Object.assign(document.createElement('div'), { className: 'context-menu', role: 'menu' })
    const item = (label, action) => {
      const button = Object.assign(document.createElement('button'), {
        type: 'button',
        className: 'context-menu-item',
        role: 'menuitem',
        textContent: label,
      })
      button.addEventListener('click', () => {
        this.closeMenu()
        action()
      })
      menu.append(button)
    }

    const folder = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : ''
    if (node.kind === 'folder') {
      item('New note here', () => this.callbacks.onNewNote(node.path))
      item('New folder here', () => this.callbacks.onNewFolder(node.path))
    } else {
      item('New note here', () => this.callbacks.onNewNote(folder))
      item('New folder here', () => this.callbacks.onNewFolder(folder))
      item('Duplicate', () => this.callbacks.onDuplicate(node.path))
    }
    item('Rename', () => this.callbacks.onRename(node))
    item('Delete', () => this.callbacks.onDelete(node))

    menu.style.left = `${Math.min(x, window.innerWidth - 200)}px`
    menu.style.top = `${Math.min(y, window.innerHeight - 220)}px`
    document.body.append(menu)
    this.menu = menu
  }
}
