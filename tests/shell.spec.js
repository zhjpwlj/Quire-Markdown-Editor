import { test, expect } from '@playwright/test'

test('shell boots offline after one online visit', async ({ page, context }) => {
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))

  await page.goto('/')
  await expect(page.locator('.app-name')).toHaveText('Quire')
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null)

  await context.setOffline(true)
  await page.reload()

  await expect(page.getByRole('heading', { name: 'Quire' })).toBeVisible()
  await expect(page.locator('.editor-empty p')).toHaveText(/Local-first markdown notes/)
  // Guards the "precache hit but response unusable" failure: unstyled offline page still looks loaded.
  await expect(page.locator('.app')).toHaveAttribute('data-ready', 'true')
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(14, 14, 17)')

  await context.setOffline(false)

  expect(errors).toEqual([])
})

test('manifest is installable and CSP blocks foreign origins', async ({ page, request }) => {
  const response = await request.get('/manifest.webmanifest')
  expect(response.ok()).toBe(true)
  const manifest = await response.json()
  expect(manifest.display).toBe('standalone')
  expect(manifest.icons).toHaveLength(3)

  await page.goto('/')
  const blocked = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/')
      return false
    } catch {
      return true
    }
  })
  expect(blocked, 'CSP must block a non-allowlisted origin').toBe(true)
})
