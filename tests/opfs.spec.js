import { test, expect } from '@playwright/test'

test.use({ baseURL: 'http://localhost:5199' })

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/fixtures/opfs.html')
  await page.waitForFunction(() => !!window.opfs)
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry('quire', { recursive: true }).catch(() => {})
  })
})

test('writes, reads, lists and overwrites notes', async ({ page }) => {
  const result = await page.evaluate(async () => {
    await window.opfs.writeNote('v1', 'note.md', '# hello — ünïcode\n')
    await window.opfs.writeNote('v1', 'folder/deep/child.md', 'child')
    await window.opfs.writeNote('v1', 'note.md', 'replaced')
    return {
      text: await window.opfs.readNote('v1', 'note.md'),
      list: (await window.opfs.listNotes('v1')).map((n) => n.path),
    }
  })
  expect(result.text).toBe('replaced')
  expect(result.list).toEqual(['folder/deep/child.md', 'note.md'])
})

test('delete moves the note to trash and is recoverable', async ({ page }) => {
  const result = await page.evaluate(async () => {
    await window.opfs.writeNote('v1', 'doomed.md', 'keep me')
    const trashPath = await window.opfs.trashNote('v1', 'doomed.md')
    return {
      trashPath,
      list: (await window.opfs.listNotes('v1')).map((n) => n.path),
      trashed: await window.opfs.readNote('v1', trashPath),
    }
  })
  expect(result.list).toEqual([])
  expect(result.trashPath).toMatch(/^\.trash\/[^/]+\/doomed\.md$/)
  expect(result.trashed).toBe('keep me')
})

test('rejects traversal and device-state paths', async ({ page }) => {
  const errors = await page.evaluate(async () => {
    const bad = ['../escape.md', '/abs.md', 'a/../../b.md', '.quire/vault.json', '']
    const out = []
    for (const path of bad) {
      try {
        await window.opfs.writeNote('v1', path, 'x')
        out.push('accepted')
      } catch (error) {
        out.push(error.message)
      }
    }
    return out
  })
  expect(errors).toEqual(Array(5).fill('ERR_BAD_PATH'))
})

test('notes survive a reload', async ({ page }) => {
  await page.evaluate(() => window.opfs.writeNote('v1', 'persist.md', 'still here'))
  await page.reload()
  await page.waitForFunction(() => !!window.opfs)
  expect(await page.evaluate(() => window.opfs.readNote('v1', 'persist.md'))).toBe('still here')
})
