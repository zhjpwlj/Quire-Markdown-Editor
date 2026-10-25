import { test, expect } from '@playwright/test'

test.use({ baseURL: 'http://localhost:5199' })

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/fixtures/links.html')
  await page.waitForFunction(() => !!window.LinkIndex)
})

test('indexes outgoing links, backlinks and note embeds, ignoring attachments', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const notes = {
      'Alpha.md': 'links to [[Beta]] and [[Gamma#Heading]]',
      'Beta.md': 'back to [[Alpha|the start]]',
      'folder/Gamma.md': 'see ![[Alpha]] and ![[pic.png]]',
      'pic.png': '',
    }
    const index = new window.LinkIndex({
      listNotes: async () => Object.keys(notes).map((path) => ({ path })),
      readNote: async (path) => notes[path],
    })
    await index.rebuild()
    return {
      outgoing: index.getOutgoing('Alpha.md').map((link) => [link.target, link.path, link.anchor]),
      backlinks: index.getBacklinks('Beta.md'),
      gammaBacklinks: index.getBacklinks('folder/Gamma.md').map((item) => item.path),
      all: index.getAllLinks(),
      resolved: index.resolveLink('gamma', 'Alpha.md'),
    }
  })

  expect(out.outgoing).toEqual([
    ['Beta', 'Beta.md', ''],
    ['Gamma', 'folder/Gamma.md', 'Heading'],
  ])
  expect(out.backlinks).toEqual([{ path: 'Alpha.md', contexts: ['links to [[Beta]] and [[Gamma#Heading]]'] }])
  expect(out.gammaBacklinks).toEqual(['Alpha.md'])
  expect(out.all.map((link) => [link.from, link.to])).toEqual([
    ['Alpha.md', 'Beta.md'],
    ['Alpha.md', 'folder/Gamma.md'],
    ['Beta.md', 'Alpha.md'],
    ['folder/Gamma.md', 'Alpha.md'],
  ])
  expect(out.resolved).toBe('folder/Gamma.md')
})

test('update reindexes a saved note; remove drops it', async ({ page }) => {  const out = await page.evaluate(async () => {
    const notes = {
      'A.md': '[[B]]',
      'B.md': 'no links',
      'C.md': '',
    }
    const index = new window.LinkIndex({
      listNotes: async () => Object.keys(notes).map((path) => ({ path })),
      readNote: async (path) => notes[path],
    })
    await index.rebuild()
    const before = index.getBacklinks('C.md').length

    await index.update('B.md', 'now [[C]]')
    const afterUpdate = index.getBacklinks('C.md').map((item) => item.path)
    const oldBacklink = index.getBacklinks('B.md').length

    index.remove('A.md')
    return {
      before,
      afterUpdate,
      oldBacklink,
      afterRemove: index.getBacklinks('B.md').length,
      outgoingB: index.getOutgoing('B.md').map((link) => link.target),
    }
  })

  expect(out.before).toBe(0)
  expect(out.afterUpdate).toEqual(['B.md'])
  expect(out.oldBacklink).toBe(1)
  expect(out.afterRemove).toBe(0)
  expect(out.outgoingB).toEqual(['C'])
})

test('reports ambiguous filenames instead of silently picking one', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const notes = {
      'a/Note.md': '',
      'b/Note.md': '',
      'x/Here.md': '[[Note]]',
    }
    const index = new window.LinkIndex({
      listNotes: async () => Object.keys(notes).map((path) => ({ path })),
      readNote: async (path) => notes[path],
    })
    await index.rebuild()
    return {
      far: index.resolveLinkInfo('Note', 'x/Here.md'),
      sameFolder: index.resolveLinkInfo('Note', 'b/Here.md'),
      outgoing: index.getOutgoing('x/Here.md').map((link) => [link.path, link.ambiguous]),
    }
  })

  expect(out.far).toEqual({
    path: 'a/Note.md',
    ambiguous: true,
    candidates: ['a/Note.md', 'b/Note.md'],
  })
  expect(out.sameFolder).toEqual({ path: 'b/Note.md', ambiguous: false, candidates: ['b/Note.md'] })
  expect(out.outgoing).toEqual([['a/Note.md', true]])
})
