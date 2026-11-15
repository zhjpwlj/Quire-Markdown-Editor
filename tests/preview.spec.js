import { test, expect } from '@playwright/test'

const appReady = async (page) => {
  await page.waitForFunction(() => window.__quire?.ready)
  await page.evaluate(() => window.__quire.ready)
}

async function freshVault(page) {
  await page.goto('/')
  await appReady(page)
  await page.evaluate(() => window.__quire.vault.createVault({ name: 'Preview Test' }))
  await page.reload()
  await appReady(page)
}

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const loadAttachments = (page) => page.evaluate(async (png) => {
  const { vault, opfs, fileModel } = window.__quire
  const base = `quire/vaults/${vault.getActiveVault().id}`
  const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0))
  for (let i = 1; i <= 5; i += 1) {
    await opfs.writeFile(`${base}/image-${i}.png`, new Blob([bytes], { type: 'image/png' }))
  }
  await opfs.writeFile(`${base}/file.pdf`, new Blob(['%PDF-1.4'], { type: 'application/pdf' }))
  return fileModel.loadAttachments()
}, PNG_1X1)

test('renders every extension into html plus metadata', async ({ page }) => {
  await freshVault(page)
  await loadAttachments(page)

  const result = await page.evaluate(() => {
    const out = window.__quire.pipeline.render(
      '# Title\n\nA [[note|Display]] and [[other#sec]] and #tag.\n\n![[image-1.png]]\n\n![[file.pdf]]\n',
    )
    return { ...out, blobUrls: window.__quire.blobUrlsFor(out.renderId) }
  })
  await page.evaluate((renderId) => window.__quire.releaseBlobUrls(renderId), result.renderId)

  expect(result.html).toContain('data-wikilink="note"')
  expect(result.html).toContain('>Display</a>')
  expect(result.html).toContain('data-anchor="sec"')
  expect(result.html).toContain('<a class="tag">#tag</a>')
  expect(result.html).toContain('data-embed="image-1.png"')
  expect(result.html).toContain('src="blob:')
  expect(result.html).toContain('class="embed-file"')
  expect(result.html).toContain('<h1 id="title">Title</h1>')

  expect(result.links).toEqual([
    { target: 'note', display: 'Display', isEmbed: false, anchor: null },
    { target: 'other', display: 'other', isEmbed: false, anchor: 'sec' },
    { target: 'image-1.png', display: 'image-1.png', isEmbed: true, anchor: null },
    { target: 'file.pdf', display: 'file.pdf', isEmbed: true, anchor: null },
  ])
  expect(result.embeds).toEqual([
    { path: 'image-1.png', isMissing: false },
    { path: 'file.pdf', isMissing: false },
  ])
  expect(result.headings).toEqual([{ level: 1, id: 'title', text: 'Title' }])
  expect(result.blobUrls).toHaveLength(2)
})

test('unresolved wiki-links render muted', async ({ page }) => {
  await freshVault(page)
  const html = await page.evaluate(() => window.__quire.pipeline.render('[[broken]]').html)
  expect(html).toContain('class="wikilink wikilink-unresolved"')
  expect(html).toContain('data-wikilink="broken"')
})

test('missing embed keeps the original text', async ({ page }) => {
  await freshVault(page)
  const html = await page.evaluate(() => window.__quire.pipeline.render('![[missing.png]]').html)
  expect(html).toContain('<span class="embed-missing">![[missing.png]]</span>')
})

test('script tags never execute in preview', async ({ page }) => {
  await freshVault(page)
  let dialogs = 0
  page.on('dialog', async (dialog) => {
    dialogs += 1
    await dialog.dismiss()
  })

  const html = await page.evaluate(() => window.__quire.pipeline.render('hello\n\n<script>alert(1)</script>').html)
  expect(html).not.toContain('<script')
  expect(dialogs).toBe(0)

  await page.evaluate(async () => {
    const { fileModel } = window.__quire
    await fileModel.createNote('xss.md', 'hello\n\n<script>alert(1)</script>')
    await window.__quire.openNote('xss.md')
    window.__quire.editor().setMode('preview')
  })
  expect(await page.locator('.editor-preview script').count()).toBe(0)
  expect(dialogs).toBe(0)
})

test('on* handlers are stripped from raw html', async ({ page }) => {
  await freshVault(page)
  const html = await page.evaluate(() => window.__quire.pipeline.render('<img src=x onerror=alert(1)>').html)
  expect(html).not.toContain('onerror')
  expect(html).toContain('src="x"')
})

test('blob URLs balance across preview open/close cycles', async ({ page }) => {
  await page.addInitScript(() => {
    const create = URL.createObjectURL.bind(URL)
    const revoke = URL.revokeObjectURL.bind(URL)
    window.__urls = { created: 0, revoked: 0 }
    URL.createObjectURL = (blob) => {
      window.__urls.created += 1
      return create(blob)
    }
    URL.revokeObjectURL = (url) => {
      window.__urls.revoked += 1
      return revoke(url)
    }
  })

  await freshVault(page)
  await loadAttachments(page)
  await page.evaluate(async () => {
    const images = Array.from({ length: 5 }, (_, i) => `![[image-${i + 1}.png]]`).join('\n\n')
    await window.__quire.fileModel.createNote('images.md', images)
    await window.__quire.openNote('images.md')
  })

  for (let cycle = 0; cycle < 2; cycle += 1) {
    await page.evaluate(() => window.__quire.editor().setMode('preview'))
    expect(await page.evaluate(() => window.__urls.created - window.__urls.revoked)).toBe(5)
    await page.evaluate(() => window.__quire.editor().setMode('source'))
    expect(await page.evaluate(() => window.__urls.created - window.__urls.revoked)).toBe(0)
  }
})

test('two renders never share blob URLs and revoke independently', async ({ page }) => {
  await freshVault(page)
  await loadAttachments(page)

  const result = await page.evaluate(async () => {
    const { pipeline, blobUrlsFor, releaseBlobUrls } = window.__quire
    const a = pipeline.render('![[image-1.png]]')
    const b = pipeline.render('![[image-1.png]]')
    const [aUrl] = blobUrlsFor(a.renderId)
    const [bUrl] = blobUrlsFor(b.renderId)
    // CSP connect-src does not allow blob:, so validity is checked through an <img>.
    const loads = (url) => new Promise((resolve) => {
      const image = new Image()
      image.onload = () => resolve(true)
      image.onerror = () => resolve(false)
      image.src = url
    })
    const bothLive = [await loads(aUrl), await loads(bUrl)]
    releaseBlobUrls(a.renderId)
    const afterRelease = {
      first: blobUrlsFor(a.renderId),
      second: blobUrlsFor(b.renderId),
      secondStillLoads: await loads(bUrl),
      firstLoads: await loads(aUrl),
    }
    return { same: aUrl === bUrl, bothLive, afterRelease }
  })

  expect(result.same).toBe(false)
  expect(result.bothLive).toEqual([true, true])
  expect(result.afterRelease.first).toBeNull()
  expect(result.afterRelease.second).toHaveLength(1)
  expect(result.afterRelease.secondStillLoads).toBe(true)
  expect(result.afterRelease.firstLoads).toBe(false)
})

test('heading ids are stable and duplicate slugs are suffixed', async ({ page }) => {
  await freshVault(page)
  const result = await page.evaluate(() => {
    const md = '# One\n\n## Two\n\n## Two\n\n### Three!\n'
    const a = window.__quire.pipeline.render(md)
    const b = window.__quire.pipeline.render(md)
    window.__quire.releaseBlobUrls(a.renderId)
    window.__quire.releaseBlobUrls(b.renderId)
    return { a: a.headings, b: b.headings }
  })

  expect(result.a).toEqual([
    { level: 1, id: 'one', text: 'One' },
    { level: 2, id: 'two', text: 'Two' },
    { level: 2, id: 'two-1', text: 'Two' },
    { level: 3, id: 'three', text: 'Three!' },
  ])
  expect(result.b).toEqual(result.a)
})
