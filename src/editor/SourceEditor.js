import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'

// CodeMirror 6 wrapper. Nothing here knows about vaults or files; M10 restyles it via the
// theme CSS vars, M30a swaps in a richer surface behind the same three calls.
export class SourceEditor {
  constructor(host, { onChange } = {}) {
    this.extensions = [
      history(),
      lineNumbers(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      syntaxHighlighting(defaultHighlightStyle),
      EditorView.lineWrapping,
      oneDark,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange?.(update.state.doc.toString())
      }),
    ]
    this.view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: '', extensions: this.extensions }),
    })
  }

  // setState, not a replace dispatch: opening another note must not leave its text in undo.
  load(content, path) {
    this.path = path
    this.view.setState(EditorState.create({ doc: content, extensions: this.extensions }))
  }

  getContent() {
    return this.view.state.doc.toString()
  }

  focus() {
    this.view.focus()
  }

  destroy() {
    this.view.destroy()
  }
}
