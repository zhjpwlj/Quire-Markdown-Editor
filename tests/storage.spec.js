import { test, expect } from '@playwright/test'

const appReady = async (page) => {
  await page.waitForFunction(() => window.__quire?.ready)
  await page.evaluate(() => window.__quire.ready)
}

test('vault, note, and active vault survive a restart', async ({ page }) => {
  await page.goto('/')
  await appReady(page)

  const id = await page.evaluate(async () => {
    const { vault, opfs } = window.__quire
    const record = await vault.createVault({ name: 'Test 1' })
    await opfs.writeFile(`quire/vaults/${record.id}/hello.md`, 'Hello world')
    return record.id
  })

  await page.reload()
  await appReady(page)

  expect(await page.evaluate(async () => {
    const { vault, opfs } = window.__quire
    const active = vault.getActiveVault()
    return { id: active.id, name: active.name, text: await opfs.readFile(`quire/vaults/${active.id}/hello.md`) }
  })).toEqual({ id, name: 'Test 1', text: 'Hello world' })
  await expect(page.locator('#vault-name')).toHaveText('Test 1')
})

test('delete moves to trash, emptyTrash clears it', async ({ page }) => {
  await page.goto('/')
  await appReady(page)

  const result = await page.evaluate(async () => {
    const { vault, opfs, trash } = window.__quire
    const record = await vault.createVault({ name: 'Trash Test' })
    await opfs.writeFile(`quire/vaults/${record.id}/note.md`, 'x')

    const target = await trash.moveToTrash(record.id, 'note.md')
    const afterMove = await opfs.listFiles(`quire/vaults/${record.id}/.trash`, { recursive: true })
    const original = await opfs.readFile(`quire/vaults/${record.id}/note.md`)

    await trash.emptyTrash(record.id)
    const afterEmpty = await opfs.listFiles(`quire/vaults/${record.id}/.trash`, { recursive: true })
    return { target, paths: afterMove.map((entry) => entry.path), original, afterEmpty }
  })

  expect(result.target).toMatch(/^\.trash\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\/note\.md$/)
  expect(result.paths.some((path) => path.endsWith(result.target))).toBe(true)
  expect(result.original).toBeNull()
  expect(result.afterEmpty).toEqual([])
})

test('three vaults switch, list in order, delete moves the folder', async ({ page }) => {
  await page.goto('/')
  await appReady(page)

  const ids = await page.evaluate(async () => {
    const { vault } = window.__quire
    const a = await vault.createVault({ name: 'A' })
    const b = await vault.createVault({ name: 'B' })
    const c = await vault.createVault({ name: 'C' })
    await vault.switchTo(a.id)
    await vault.deleteVault(b.id)
    return [a.id, b.id, c.id]
  })

  expect(await page.evaluate(async () => (await window.__quire.vault.listVaults()).map((record) => record.name))).toEqual(['A', 'C'])
  expect(await page.evaluate(async () => window.__quire.vault.getActiveVault().name)).toBe('A')

  await page.reload()
  await appReady(page)
  expect(await page.evaluate(async () => (await window.__quire.vault.listVaults()).map((record) => record.name))).toEqual(['A', 'C'])

  const trashFolders = await page.evaluate(() => window.__quire.opfs.listFiles('quire/vaults/.trash', { recursive: true }))
  expect(trashFolders.some((entry) => entry.name.startsWith(ids[1]))).toBe(true)
})

test('evicted OPFS prompts for a first vault instead of crashing', async ({ page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))

  await page.goto('/')
  await appReady(page)
  await page.evaluate(async () => {
    await window.__quire.vault.createVault({ name: 'Doomed' })
    const root = await navigator.storage.getDirectory()
    for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true })
  })

  await page.reload()
  await appReady(page)

  await expect(page.getByRole('button', { name: /Create/ })).toBeVisible()
  await expect(page.locator('#vault-name')).toHaveText('No vault open')
  expect(await page.evaluate(async () => (await window.__quire.vault.listVaults()).length)).toBe(0)
  expect(errors).toEqual([])
})

test('persist() returning false changes nothing', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.storage.persist = async () => false
  })
  await page.goto('/')
  await appReady(page)

  await page.evaluate(async () => {
    const { vault, opfs } = window.__quire
    const record = await vault.createVault({ name: 'No Persist' })
    await opfs.writeFile(`quire/vaults/${record.id}/note.md`, 'kept')
  })
  await page.reload()
  await appReady(page)

  expect(await page.evaluate(async () => {
    const active = window.__quire.vault.getActiveVault()
    return window.__quire.opfs.readFile(`quire/vaults/${active.id}/note.md`)
  })).toBe('kept')
})

test('localStorage holds only activeVaultId and vaultOrder', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  await page.evaluate(async () => {
    await window.__quire.vault.createVault({ name: 'Keys' })
  })
  expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual(['activeVaultId', 'vaultOrder'])
})
