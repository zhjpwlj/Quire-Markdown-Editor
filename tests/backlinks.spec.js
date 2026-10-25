import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('shows backlinks and opening one navigates to the source', async ({ page }) => {
  await page.getByRole('button', { name: 'New note', exact: true }).click()
  await expect(page.locator('#status-path')).toHaveText('Untitled.md')
  await page.locator('.cm-content').click()
  await page.keyboard.type('links to [[Untitled 2]]')
  await expect(page.locator('#save-state')).toHaveText('Saved')

  await page.getByRole('button', { name: 'New note', exact: true }).click()
  await expect(page.locator('#status-path')).toHaveText('Untitled 2.md')
  await expect(page.locator('#links-panel')).toBeVisible()
  await expect(page.locator('#backlinks .link-item')).toHaveText(/Untitled/)
  await expect(page.locator('#backlinks .link-context')).toContainText('links to [[Untitled 2]]')

  await page.locator('#backlinks .link-item').click()
  await expect(page.locator('#status-path')).toHaveText('Untitled.md')
  await expect(page.locator('#outgoing .link-item')).toHaveText(/Untitled 2/)
})

test('editing a note updates the backlink panel without a reload', async ({ page }) => {
  await page.getByRole('button', { name: 'New note', exact: true }).click()
  await expect(page.locator('#status-path')).toHaveText('Untitled.md')
  await page.locator('.cm-content').click()
  await page.keyboard.type('links to [[Untitled 2]]')
  await expect(page.locator('#save-state')).toHaveText('Saved')

  await page.getByRole('button', { name: 'New note', exact: true }).click()
  await expect(page.locator('#status-path')).toHaveText('Untitled 2.md')
  await expect(page.locator('#backlinks .link-item')).toHaveCount(1)

  await page.locator('.tree-note', { hasText: /^Untitled$/ }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('no links now')
  await expect(page.locator('#save-state')).toHaveText('Saved')

  await page.locator('.tree-note', { hasText: /^Untitled 2$/ }).click()
  await expect(page.locator('#backlinks .link-empty')).toHaveText('No backlinks')
})

test('rename keeps backlinks pointing at the renamed note', async ({ page }) => {
  await page.getByRole('button', { name: 'New note', exact: true }).click()
  await expect(page.locator('#status-path')).toHaveText('Untitled.md')
  await page.locator('.cm-content').click()
  await page.keyboard.type('links to [[Untitled 2]]')
  await expect(page.locator('#save-state')).toHaveText('Saved')

  await page.getByRole('button', { name: 'New note', exact: true }).click()
  await expect(page.locator('#status-path')).toHaveText('Untitled 2.md')

  page.once('dialog', (dialog) => dialog.accept('Target'))
  await page.getByRole('button', { name: 'Rename', exact: true }).click()
  await expect(page.locator('#status-path')).toHaveText('Target.md')
  await expect(page.locator('#backlinks .link-item')).toHaveText(/Untitled/)

  await page.locator('#backlinks .link-item').click()
  await expect(page.locator('.cm-content')).toContainText('links to [[Target]]')
})

test('unresolved outgoing link offers to create the note', async ({ page }) => {
  await page.getByRole('button', { name: 'New note', exact: true }).click()
  await expect(page.locator('#status-path')).toHaveText('Untitled.md')
  await page.locator('.cm-content').click()
  await page.keyboard.type('go [[Missing]]')
  await expect(page.locator('#save-state')).toHaveText('Saved')

  await expect(page.locator('#outgoing .link-unresolved')).toHaveText('Missing')
  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('#outgoing .link-unresolved').click()
  await expect(page.locator('#status-path')).toHaveText('Missing.md')
  await expect(page.locator('.tree-note')).toHaveText(['Missing', 'Untitled'])
})
