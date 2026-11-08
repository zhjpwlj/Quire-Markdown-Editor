import { test, expect } from '@playwright/test'

const appReady = async (page) => {
  await page.waitForFunction(() => window.__quire?.ready)
  await page.evaluate(() => window.__quire.ready)
}

// The app opens the active vault at boot, so create it first, then reload.
async function freshVault(page, name = 'Editor Test') {
  await page.goto('/')
  await appReady(page)
  await page.evaluate((vaultName) => window.__quire.vault.createVault({ name: vaultName }), name)
  await page.reload()
  await appReady(page)
}

const rawNote = (page, path) =>
  page.evaluate((notePath) => {
    const { vault, opfs } = window.__quire
    return opfs.readFile(`quire/vaults/${vault.getActiveVault().id}/${notePath}`)
  }, path)

test('typing writes to disk after the 500ms debounce', async ({ page }) => {
  await freshVault(page)
  await page.evaluate(() => window.__quire.fileModel.createNote('note.md', 'start'))
  await page.evaluate(() => window.__quire.openNote('note.md'))

  await expect(page.locator('.cm-content')).toBeVisible()
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('Hello')
  await page.waitForTimeout(700)

  expect(await rawNote(page, 'note.md')).toBe('startHello')
})

test('pagehide flush saves pending keystrokes', async ({ page }) => {
  await freshVault(page)
  await page.evaluate(() => window.__quire.fileModel.createNote('note.md', 'start'))
  await page.evaluate(() => window.__quire.openNote('note.md'))

  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('Flush')
  // No wait for the debounce: dispatching pagehide must flush it. Playwright's reload tears the
  // context down mid-write, so the event is dispatched explicitly here.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await page.waitForFunction(() => window.__quire.fileModel.notes.get('note.md')?.dirty === false)

  expect(await rawNote(page, 'note.md')).toBe('startFlush')
})

test('frontmatter survives a round-trip byte-identical', async ({ page }) => {
  await freshVault(page)
  const before = '---\ntitle: x\n---\n\nBody\n'
  await page.evaluate((content) => window.__quire.fileModel.createNote('front.md', content), before)
  await page.evaluate(() => window.__quire.openNote('front.md'))

  const result = await page.evaluate(async () => {
    const { fileModel } = window.__quire
    const loaded = await fileModel.readNote('front.md')
    fileModel.writeNote('front.md', loaded.content)
    await fileModel.flush()
    return loaded.content
  })

  expect(result).toBe(before)
  expect(await rawNote(page, 'front.md')).toBe(before)
})

test('note, mtime and size survive a restart', async ({ page }) => {
  await freshVault(page)
  const createdAt = await page.evaluate(async () => {
    const note = await window.__quire.fileModel.createNote('persist.md', 'hello')
    return note.mtime
  })

  await page.evaluate(async () => {
    const { fileModel } = window.__quire
    fileModel.writeNote('persist.md', 'hello world')
    await fileModel.flush()
  })

  const saved = await page.evaluate(() => {
    const note = window.__quire.fileModel.notes.get('persist.md')
    return { dirty: note.dirty, mtime: note.mtime, size: note.size }
  })
  expect(saved.dirty).toBe(false)
  expect(saved.mtime).toBeGreaterThanOrEqual(createdAt)
  expect(saved.size).toBe('hello world'.length)

  await page.reload()
  await appReady(page)

  const reopened = await page.evaluate(async () => {
    const note = await window.__quire.fileModel.readNote('persist.md')
    return { content: note.content, mtime: note.mtime, size: note.size }
  })
  expect(reopened.content).toBe('hello world')
  expect(reopened.size).toBe(saved.size)
  // OPFS lastModified and Date.now() can differ by a millisecond.
  expect(reopened.mtime).toBeGreaterThanOrEqual(createdAt)
})

test('dirty is true while editing and false after flush', async ({ page }) => {
  await freshVault(page)
  await page.evaluate(() => window.__quire.fileModel.createNote('dirty.md', 'a'))
  await page.evaluate(() => window.__quire.openNote('dirty.md'))

  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('b')

  expect(await page.evaluate(() => window.__quire.fileModel.notes.get('dirty.md').dirty)).toBe(true)

  await page.evaluate(() => window.__quire.fileModel.flush())
  expect(await page.evaluate(() => window.__quire.fileModel.notes.get('dirty.md').dirty)).toBe(false)
})

test('rapid navigation keeps one editor and logs no warnings', async ({ page }) => {
  const messages = []
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') messages.push(message.text())
  })
  page.on('pageerror', (error) => messages.push(String(error)))

  await freshVault(page)
  await page.evaluate(async () => {
    const { fileModel } = window.__quire
    await fileModel.createNote('a.md', '# A\n')
    await fileModel.createNote('b.md', '# B\n')
    for (let i = 0; i < 5; i += 1) {
      await window.__quire.openNote('a.md')
      await window.__quire.openNote('b.md')
    }
  })

  expect(await page.locator('.cm-editor').count()).toBe(1)
  expect(messages.filter((text) => /CodeMirror/i.test(text))).toEqual([])
})
