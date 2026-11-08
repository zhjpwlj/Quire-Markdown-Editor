import { SourceEditor } from './SourceEditor.js'

export class NotImplementedError extends Error {
  constructor(mode) {
    super(`editor mode not implemented: ${mode}`)
    this.name = 'NotImplementedError'
    this.mode = mode
  }
}

// Mode-agnostic facade. M5 adds preview, M30a adds split; callers never see CodeMirror.
export class EditorController {
  constructor(host, { onChange } = {}) {
    this.source = new SourceEditor(host, { onChange })
    this.mode = 'source'
    this.path = null
  }

  load(content, path) {
    this.path = path
    this.source.load(content, path)
  }

  getContent() {
    return this.source.getContent()
  }

  focus() {
    this.source.focus()
  }

  setMode(mode) {
    if (mode !== 'source') throw new NotImplementedError(mode)
    this.mode = mode
  }

  destroy() {
    this.source.destroy()
  }
}
