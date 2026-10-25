import { test, expect } from '@playwright/test'

test.use({ baseURL: 'http://localhost:5199' })

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/fixtures/render.html')
  await page.waitForFunction(() => !!window.render)
})

test('renders wiki-links, tags and headings, and strips frontmatter', async ({ page }) => {
  const result = await page.evaluate(() => {
    const markdown = '---\ntitle: hidden\n---\n# Hello\n\nSee [[Other]] and [[Missing]] #work\n'
    const resolve = window.createResolver(['Other.md'], 'Here.md')
    return window.render(markdown, { resolveLink: resolve })
  })

  expect(result.html).toContain('<h1>Hello</h1>')
  expect(result.html).not.toContain('title: hidden')
  expect(result.html).toContain('data-path="Other.md"')
  expect(result.html).toContain('wikilink-unresolved')
  expect(result.html).toContain('data-tag="work"')
  expect(result.links).toEqual([
    { target: 'Other', display: 'Other', path: 'Other.md', anchor: '' },
    { target: 'Missing', display: 'Missing', path: null, anchor: '' },
  ])
  expect(result.headings).toEqual([{ depth: 1, text: 'Hello' }])
})

test('sanitizes scripts, iframes, event handlers and javascript: links', async ({ page }) => {
  const html = await page.evaluate(async () => {
    const markdown = [
      '<script>window.__xss = 1</script>',
      '<iframe src="https://example.com"></iframe>',
      '<img src="x" onerror="window.__xss = 2">',
      '[click](javascript:alert(1))',
      '<div onclick="window.__xss = 4">raw</div>',
    ].join('\n\n')
    return (await window.render(markdown)).html
  })

  expect(html).not.toMatch(/<script|<iframe|onerror|onclick|javascript:/i)
  expect(await page.evaluate(() => window.__xss)).toBeUndefined()
})

test('embeds images as blob URLs and never trusts missing files', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const resolve = window.createResolver(['pic.png', 'Note.md'], 'Here.md')
    const resolveFile = window.createResolver(['pic.png', 'Note.md'], 'Here.md', 'file')
    const result = await window.render('![[pic.png]]\n\n![[gone.png]]\n\n![[Note]]', {
      resolveLink: resolve,
      resolveEmbed: resolveFile,
      readEmbed: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
    })
    const src = /src="(blob:[^"]+)"/.exec(result.html)?.[1]
    const live = src ? await fetch(src).then((r) => r.ok).catch(() => false) : false
    result.revoke()
    const afterRevoke = src ? await fetch(src).then((r) => r.ok).catch(() => false) : false
    return { html: result.html, src, live, afterRevoke, embeds: result.embeds }
  })

  expect(out.html).toContain('data-embed="pic.png"')
  expect(out.src).toMatch(/^blob:/)
  expect(out.live).toBe(true)
  expect(out.afterRevoke).toBe(false)
  expect(out.html).toContain('embed-missing')
  expect(out.html).toContain('data-wikilink="Note"')
  expect(out.embeds).toEqual([
    { target: 'pic.png', path: 'pic.png', missing: false },
    { target: 'gone.png', path: null, missing: true },
    { target: 'Note', path: 'Note.md', missing: false },
  ])
})

test('resolver prefers exact paths, then same folder, then shallowest', async ({ page }) => {
  const out = await page.evaluate(() => {
    const paths = ['a/Note.md', 'b/Note.md', 'deep/x/Other.md', 'Other.md']
    return {
      exact: window.createResolver(paths, 'b/Here.md')('a/Note'),
      sameFolder: window.createResolver(paths, 'b/Here.md')('Note'),
      shallow: window.createResolver(paths, 'deep/x/Here.md')('Other'),
    }
  })
  expect(out).toEqual({ exact: 'a/Note.md', sameFolder: 'b/Note.md', shallow: 'Other.md' })
})
