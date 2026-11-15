import { SourceEditor } from './SourceEditor.js'
import { releaseBlobUrls } from '../render/blobUrlRegistry.js'

export class NotImplementedError extends Error {
  constructor(mode) {
    super(`editor mode not implemented: ${mode}`)
    this.name = 'NotImplementedError'
    this.mode = mode
  }
}

// Mode-agnostic facade. M30a adds split; callers never see CodeMirror.
export class EditorController {
  constructor(host, { onChange, renderPreview } = {}) {
    this.host = host
    this.renderPreview = renderPreview ?? null
    this.sourceHost = Object.assign(document.createElement('div'), { className: 'editor-source' })
    this.previewHost = Object.assign(document.createElement('div'), { className: 'editor-preview' })
    this.previewHost.hidden = true
    host.append(this.sourceHost, this.previewHost)
    this.source = new SourceEditor(this.sourceHost, { onChange })
    this.mode = 'source'
    this.path = null
    this.renderId = null
  }

  load(content, path) {
    this.path = path
    this.source.load(content, path)
    if (this.mode === 'preview') this.renderIntoPreview()
  }

  getContent() {
    return this.source.getContent()
  }

  focus() {
    this.source.focus()
  }

  setMode(mode) {
    if (!['source', 'preview', 'split'].includes(mode)) throw new NotImplementedError(mode)
    if (mode === 'split') throw new NotImplementedError(mode)
    if (mode === this.mode) return this.mode

    if (mode === 'preview') {
      if (!this.renderPreview) throw new Error('preview renderer not configured')
      this.renderIntoPreview()
      this.sourceHost.hidden = true
      this.previewHost.hidden = false
    } else {
      this.releasePreview()
      this.previewHost.replaceChildren()
      this.previewHost.hidden = true
      this.sourceHost.hidden = false
      this.source.focus()
    }
    this.mode = mode
    return this.mode
  }

  // Read-only preview: the HTML is already sanitized by RenderPipeline.
  renderIntoPreview() {
    this.releasePreview()
    const result = this.renderPreview(this.getContent())
    this.renderId = result.renderId
    // eslint-disable-next-line no-unsanitized/property -- sanitize() runs inside RenderPipeline
    this.previewHost.innerHTML = result.html
  }

  releasePreview() {
    if (!this.renderId) return
    releaseBlobUrls(this.renderId)
    this.renderId = null
  }

  destroy() {
    this.releasePreview()
    this.source.destroy()
  }
}
