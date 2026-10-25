// EditorController, source mode (§6.3). CodeMirror 6 with markdown highlighting.
// RichEditor (Milkdown) lands with Simple Mode; this is the only implementation for now.
import { basicSetup, EditorView } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { tags } from '@lezer/highlight'

const theme = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: 'var(--editor-bg)',
      color: 'var(--editor-text)',
      fontSize: 'var(--editor-font-size)',
    },
    '.cm-scroller': {
      fontFamily: 'var(--editor-font-family)',
      lineHeight: 'var(--editor-line-height)',
      overflow: 'auto',
    },
    '.cm-content': { padding: '20px 0', caretColor: 'var(--editor-cursor-color)' },
    '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--editor-cursor-color)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--editor-selection-bg)',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--editor-bg)',
      color: 'var(--text-muted)',
      border: 'none',
    },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--bg-hover)' },
  },
  // shortcut: static dark flag; light themes still read correctly because every visible
  // surface is overridden above. Upgrade if a light theme shows dark defaults.
  { dark: true },
)

const highlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.4em', fontWeight: '700', color: 'var(--syntax-heading)' },
  { tag: [tags.heading2, tags.heading3, tags.heading4], fontWeight: '600', color: 'var(--syntax-heading)' },
  { tag: tags.strong, fontWeight: '700', color: 'var(--syntax-emphasis)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: [tags.link, tags.url], color: 'var(--syntax-link)' },
  { tag: tags.monospace, color: 'var(--syntax-code)', fontFamily: 'var(--font-family-mono)' },
  { tag: tags.meta, color: 'var(--syntax-frontmatter)' },
])

export function createEditor(parent, { onInput, onSave }) {
  let applying = false

  const extensions = [
    basicSetup,
    markdown(),
    syntaxHighlighting(highlight),
    theme,
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (!applying && update.docChanged) onInput(update.state.doc.toString())
    }),
    keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (onSave(), true) }]),
  ]

  const view = new EditorView({ parent, state: EditorState.create({ doc: '', extensions }) })

  return {
    // Loading dispatches under a flag so opening a note never marks it dirty.
    load(content) {
      applying = true
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } })
      applying = false
      view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true })
    },
    getContent: () => view.state.doc.toString(),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  }
}
