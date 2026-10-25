import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('creates a note, autosaves, and reloads it', async ({ page }) => {
  await page.getByRole('button', { name: 'New note' }).click()
  await expect(page.locator('.note-list button')).toHaveCount(1)
  await expect(page.locator('#status-path')).toHaveText('Untitled.md')

  await page.locator('.cm-content').click()
  await page.keyboard.type('# Hello world\n\nfirst note')

  await expect(page.locator('#save-state')).toHaveText('Saving…')
  await expect(page.locator('#save-state')).toHaveText('Saved', { timeout: 5000 })

  await page.reload()
  await expect(page.locator('.note-list button')).toHaveCount(1)
  await page.locator('.note-list button').first().click()
  await expect(page.locator('.cm-content')).toContainText('Hello world')
})

test('switching notes flushes the pending save', async ({ page }) => {
  await page.getByRole('button', { name: 'New note' }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.type('alpha')
  await page.getByRole('button', { name: 'New note' }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.type('beta')

  await page.locator('.note-list button', { hasText: /^Untitled$/ }).click()
  await expect(page.locator('.cm-content')).toContainText('alpha')

  await page.reload()
  await page.locator('.note-list button', { hasText: /^Untitled$/ }).click()
  await expect(page.locator('.cm-content')).toContainText('alpha')
  await page.locator('.note-list button', { hasText: /^Untitled 2$/ }).click()
  await expect(page.locator('.cm-content')).toContainText('beta')
})

test('new notes get unique names', async ({ page }) => {
  await page.getByRole('button', { name: 'New note' }).click()
  await page.getByRole('button', { name: 'New note' }).click()
  await expect(page.locator('.note-list button')).toHaveText(['Untitled 2', 'Untitled'])
})
