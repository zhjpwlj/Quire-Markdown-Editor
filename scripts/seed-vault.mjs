// Seeds a vault through the app's own storage API. Node has no OPFS, so this drives a
// browser. Usage: node scripts/seed-vault.mjs [url]   (default http://localhost:4173)
import { chromium } from '@playwright/test'

const url = process.argv[2] ?? 'http://localhost:4173'
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(url)
await page.waitForFunction(() => window.__quire?.ready)
await page.evaluate(() => window.__quire.ready)

const result = await page.evaluate(async () => {
  const { vault, opfs } = window.__quire
  const existing = (await vault.listVaults()).find((record) => record.name === 'Seed')
  const record = existing ?? (await vault.createVault({ name: 'Seed' }))
  const files = {
    'welcome.md': '# Welcome\n\nSeeded vault.',
    'notes/one.md': '# One\n\nFirst note.',
    'notes/two.md': '# Two\n\nSecond note.',
  }
  for (const [path, body] of Object.entries(files)) {
    await opfs.writeFile(`quire/vaults/${record.id}/${path}`, body)
  }
  return { id: record.id, created: !existing, files: Object.keys(files) }
})

console.log(JSON.stringify(result, null, 2))
await browser.close()
