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

test('debug log scrolls its own body', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 })
  await page.goto('/')
  await page.evaluate(() => {
    for (let i = 0; i < 120; i++) console.log('entry', i)
  })

  const box = await page.locator('.app-name').boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(1200)
  await page.mouse.up()

  const metrics = await page.evaluate(() => {
    const body = document.querySelector('.debug-log-body')
    const panel = document.querySelector('.debug-log')
    body.scrollTop = body.scrollHeight
    return { scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, panelHeight: panel.getBoundingClientRect().height, scrolled: body.scrollTop }
  })
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)
  expect(metrics.panelHeight).toBeLessThanOrEqual(361)
  expect(metrics.scrolled).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})
