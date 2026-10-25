import { test, expect } from '@playwright/test'

const answer = (page, value) => page.once('dialog', (dialog) => dialog.accept(value))
const confirm = (page) => page.once('dialog', (dialog) => dialog.accept())

async function trashFiles(page) {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const vault = await (await (await (await root.getDirectoryHandle('quire')).getDirectoryHandle('vaults')).getDirectoryHandle('default')).getDirectoryHandle('.trash')
    const files = []
    for await (const [, stamp] of vault.entries()) {
      for await (const [name] of stamp.entries()) files.push(name)
    }
    return files
  })
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('creates a folder and a note inside it', async ({ page }) => {
  answer(page, 'Projects')
  await page.getByRole('button', { name: 'New folder' }).click()
  await expect(page.locator('.tree-folder')).toHaveText(/Projects/)

  await page.getByRole('button', { name: 'New note in Projects' }).click()
  await expect(page.locator('#status-path')).toHaveText('Projects/Untitled.md')
  await expect(page.locator('.tree-note')).toHaveText(['Untitled'])

  await page.reload()
  await expect(page.locator('.tree-note')).toHaveCount(0)
  await page.locator('.tree-folder').click()
  await expect(page.locator('.tree-note')).toHaveText(['Untitled'])
})

test('rename rewrites wikilinks in other notes', async ({ page }) => {
  await page.getByRole('button', { name: 'New note', exact: true }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.type('see [[Untitled 2]]')
  await expect(page.locator('#save-state')).toHaveText('Saved')

  await page.getByRole('button', { name: 'New note', exact: true }).click()
  answer(page, 'Target')
  await page.getByRole('button', { name: 'Rename' }).click()
  await expect(page.locator('#status-path')).toHaveText('Target.md')
  await expect(page.locator('.tree-note')).toHaveText(['Target', 'Untitled'])

  await page.locator('.tree-note', { hasText: /^Untitled$/ }).click()
  await expect(page.locator('.cm-content')).toContainText('see [[Target]]')

  await page.reload()
  await page.locator('.tree-note', { hasText: /^Untitled$/ }).click()
  await expect(page.locator('.cm-content')).toContainText('see [[Target]]')
})

test('delete moves the note to trash and it stays gone after reload', async ({ page }) => {
  await page.getByRole('button', { name: 'New note', exact: true }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.type('# doomed')
  await expect(page.locator('#save-state')).toHaveText('Saved')
  await expect(page.locator('.tree-note')).toHaveText(['Untitled'])

  confirm(page)
  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.locator('#status-path')).toHaveText('No note open')
  await expect(page.locator('.tree-note')).toHaveCount(0)
  await expect(page.locator('#editor-empty')).toBeVisible()

  await page.reload()
  await expect(page.locator('.tree-note')).toHaveCount(0)
  expect(await trashFiles(page)).toEqual(['Untitled.md'])
})
