import { test, expect } from '@playwright/test'

const appReady = async (page) => {
  await page.waitForFunction(() => window.__quire?.ready)
  await page.evaluate(() => window.__quire.ready)
}

async function freshVault(page) {
  await page.goto('/')
  await appReady(page)
  await page.evaluate(() => window.__quire.vault.createVault({ name: 'Sidebar Test' }))
  await page.reload()
  await appReady(page)
}

const treePaths = (page) => page.evaluate(async () => (await window.__quire.fileModel.listTree()).map((entry) => entry.path).sort())

async function dragRow(page, fromPath, toPath) {
  const from = await page.locator(`.tree-row[data-path="${fromPath}"]`).boundingBox()
  const to = await page.locator(`.tree-row[data-path="${toPath}"]`).boundingBox()
  await page.mouse.move(from.x + 24, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + 24, to.y + to.height / 2, { steps: 12 })
  await page.mouse.up()
}

test('drag a note into a folder moves it on disk', async ({ page }) => {
  await freshVault(page)
  await page.evaluate(async () => {
    const { fileModel } = window.__quire
    await fileModel.createNote('note.md', '# Note\n')
    await fileModel.createFolder('Projects')
    await window.__quire.refreshSidebar()
  })

  // Pointer events, never HTML5 DnD (iOS does not fire the latter reliably).
  expect(await page.locator('.tree-row[draggable="true"]').count()).toBe(0)
  await dragRow(page, 'note.md', 'Projects')

  await expect.poll(() => treePaths(page)).toEqual(['Projects', 'Projects/note.md'])
  expect(await page.evaluate(async () => {
    const { vault, opfs } = window.__quire
    return opfs.readFile(`quire/vaults/${vault.getActiveVault().id}/Projects/note.md`)
  })).toBe('# Note\n')
})

test('rename writes the new file, deletes the old, keeps frontmatter exact', async ({ page }) => {
  await freshVault(page)
  const before = '---\ntitle: x\naliases: [a, b]\n---\n\nBody\n'
  await page.evaluate(async (content) => {
    await window.__quire.fileModel.createNote('note.md', content)
    await window.__quire.refreshSidebar()
  }, before)

  await page.locator('.tree-row[data-path="note.md"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.locator('.modal-input').fill('note-2.md')
  await page.locator('.modal .primary-button').click()

  await expect.poll(() => treePaths(page)).toEqual(['note-2.md'])
  expect(await page.evaluate(async () => {
    const { vault, opfs } = window.__quire
    const base = `quire/vaults/${vault.getActiveVault().id}`
    return { old: await opfs.readFile(`${base}/note.md`), fresh: await opfs.readFile(`${base}/note-2.md`) }
  })).toEqual({ old: null, fresh: before })
})

test('60 backlinks prompt appears and cancel aborts before any write', async ({ page }) => {
  await freshVault(page)
  await page.evaluate(async () => {
    await window.__quire.fileModel.createNote('note.md', 'x')
    await window.__quire.refreshSidebar()
    window.__quire.LinkIndex.getIncoming = () => Array.from({ length: 60 }, (_, i) => `other-${i}.md`)
  })

  await page.locator('.tree-row[data-path="note.md"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.locator('.modal-input').fill('note-2.md')
  await page.locator('.modal .primary-button').click()

  await expect(page.locator('.modal-message')).toHaveText("Rename will update 60 notes' links. Continue?")
  await page.locator('.modal .secondary-button').click()

  await expect(page.locator('.modal')).toHaveCount(0)
  expect(await treePaths(page)).toEqual(['note.md'])
})

test('delete moves the note to trash and updates the tree', async ({ page }) => {
  await freshVault(page)
  await page.evaluate(async () => {
    await window.__quire.fileModel.createNote('note.md', 'x')
    await window.__quire.refreshSidebar()
  })

  await page.locator('.tree-row[data-path="note.md"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete' }).click()

  await expect(page.locator('.tree-row[data-path="note.md"]')).toHaveCount(0)
  expect(await treePaths(page)).toEqual([])
  expect(await page.evaluate(async () => {
    const { vault, opfs } = window.__quire
    const trashed = await opfs.listFiles(`quire/vaults/${vault.getActiveVault().id}/.trash`, { recursive: true })
    return trashed.filter((entry) => entry.kind === 'file').map((entry) => entry.path.split('/').pop())
  })).toEqual(['note.md'])
})

test('natural sort keeps folders above files at every level', async ({ page }) => {
  await freshVault(page)
  await page.evaluate(async () => {
    const { fileModel } = window.__quire
    await fileModel.createNote('Note 10.md', '')
    await fileModel.createNote('Note 2.md', '')
    await fileModel.createFolder('Zeta')
    await fileModel.createFolder('alpha')
    await window.__quire.refreshSidebar()
  })

  expect(await page.locator('.tree-row').evaluateAll((rows) => rows.map((row) => row.dataset.path)))
    .toEqual(['alpha', 'Zeta', 'Note 2.md', 'Note 10.md'])
})

test('an expanded empty folder says so', async ({ page }) => {
  await freshVault(page)
  await page.evaluate(async () => {
    await window.__quire.fileModel.createFolder('Empty')
    await window.__quire.refreshSidebar()
  })

  await page.locator('.tree-row[data-path="Empty"]').click()
  await expect(page.locator('.tree-empty')).toHaveText('This folder is empty.')
})

test('invalid filenames are rejected with a message', async ({ page }) => {
  await freshVault(page)
  await page.evaluate(async () => {
    await window.__quire.fileModel.createNote('note.md', 'x')
    await window.__quire.refreshSidebar()
  })

  await page.locator('.tree-row[data-path="note.md"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.locator('.modal-input').fill('bad/name.md')
  await page.locator('.modal .primary-button').click()

  await expect(page.locator('.modal-error')).toHaveText('Name cannot contain / \\ or :')
  expect(await treePaths(page)).toEqual(['note.md'])
})
