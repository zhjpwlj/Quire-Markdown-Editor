import { test, expect } from '@playwright/test'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function writeAttachment(page, name, base64) {
  await page.evaluate(
    async ([name, base64]) => {
      const root = await navigator.storage.getDirectory()
      let dir = await root.getDirectoryHandle('quire', { create: true })
      dir = await dir.getDirectoryHandle('vaults', { create: true })
      dir = await dir.getDirectoryHandle('default', { create: true })
      const file = await (await dir.getFileHandle(name, { create: true })).createWritable()
      await file.write(Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0)))
      await file.close()
    },
    [name, base64],
  )
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('preview renders markdown, toggles with the button and Alt+P', async ({ page }) => {
  await page.getByRole('button', { name: 'New note', exact: true }).click()
  await expect(page.locator('#status-path')).toHaveText('Untitled.md')
  await page.locator('.cm-content').click()
  await page.keyboard.type('# Hello\n\nSee [[Missing]] #work')

  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(page.locator('#preview')).toBeVisible()
  await expect(page.locator('#editor')).toBeHidden()
  await expect(page.locator('#preview h1')).toHaveText('Hello')
  await expect(page.locator('#preview .wikilink-unresolved')).toHaveText('Missing')
  await expect(page.locator('#preview .tag')).toHaveText('#work')

  await page.keyboard.press('Alt+KeyP')
  await expect(page.locator('#editor')).toBeVisible()
  await expect(page.locator('#preview')).toBeHidden()

  await page.keyboard.press('Alt+KeyP')
  await expect(page.locator('#preview')).toBeVisible()
})

test('unresolved link offers to create the note', async ({ page }) => {
  await page.getByRole('button', { name: 'New note', exact: true }).click()
  await expect(page.locator('#status-path')).toHaveText('Untitled.md')
  await page.locator('.cm-content').click()
  await page.keyboard.type('go to [[Other]]')
  await page.getByRole('button', { name: 'Preview', exact: true }).click()

  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('#preview .wikilink-unresolved').click()
  await expect(page.locator('#status-path')).toHaveText('Other.md')
  await expect(page.locator('.tree-note')).toHaveText(['Other', 'Untitled'])
})

test('embeds a real attachment as a blob image', async ({ page }) => {
  await writeAttachment(page, 'pic.png', PNG)
  await page.getByRole('button', { name: 'New note', exact: true }).click()
  await expect(page.locator('#status-path')).toHaveText('Untitled.md')
  await page.locator('.cm-content').click()
  await page.keyboard.type('![[pic.png]]')
  await page.getByRole('button', { name: 'Preview', exact: true }).click()

  const img = page.locator('#preview img[data-embed="pic.png"]')
  await expect(img).toBeVisible()
  await expect(img).toHaveAttribute('src', /^blob:/)
  expect(await img.evaluate((el) => el.naturalWidth)).toBe(1)
})

test('note content cannot inject scripts or handlers into the preview', async ({ page }) => {
  await page.getByRole('button', { name: 'New note', exact: true }).click()
  await expect(page.locator('#status-path')).toHaveText('Untitled.md')
  await page.locator('.cm-content').click()
  await page.keyboard.insertText('<img src=x onerror="window.__xss = 1"> <script>window.__xss = 2</script>')
  await page.getByRole('button', { name: 'Preview', exact: true }).click()

  await expect(page.locator('#preview h1')).toHaveCount(0)
  expect(await page.locator('#preview img[onerror]').count()).toBe(0)
  expect(await page.evaluate(() => window.__xss)).toBeUndefined()
})
