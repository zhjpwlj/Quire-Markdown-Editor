import { test, expect } from '@playwright/test'

test('only panes scroll, not the app shell', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.evaluate(() => {
    const pane = document.querySelector('.editor-pane')
    for (let i = 0; i < 100; i++) {
      const p = document.createElement('p')
      p.textContent = `line ${i}`
      pane.append(p)
    }
  })

  expect(await page.evaluate(() => document.scrollingElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0)
  await page.evaluate(() => window.scrollTo(0, 500))
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  expect(await page.evaluate(() => {
    const pane = document.querySelector('.editor-pane')
    pane.scrollTop = 200
    return pane.scrollTop
  })).toBeGreaterThan(0)
})

test('long-press on the title opens the debug log, short press does not', async ({ page }) => {
  await page.goto('/')
  const box = await page.locator('.app-name').boundingBox()
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.waitForTimeout(300)
  await page.mouse.up()
  await expect(page.locator('.debug-log')).toHaveCount(0)

  await page.mouse.down()
  await page.waitForTimeout(1200)
  await page.mouse.up()
  await expect(page.locator('.debug-log')).toBeVisible()
  await expect(page.locator('.debug-log-body')).toContainText(/ready=true|Debug|ua=/)

  await page.locator('.debug-log-close').click()
  await expect(page.locator('.debug-log')).toHaveCount(0)
})
