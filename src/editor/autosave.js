// Debounced writer. Leading-edge-with-trailing-commit (§M3): the first change starts a timer,
// later changes reset it, and the timer firing writes once. flush() writes now.
export function createAutosave(write, { delay = 500, onWritten } = {}) {
  const timers = new Map()
  const pending = new Map()
  let chain = Promise.resolve()

  async function commit(path) {
    timers.delete(path)
    if (!pending.has(path)) return
    const content = pending.get(path)
    pending.delete(path)
    await write(path, content)
    onWritten?.(path)
  }

  return {
    schedule(path, content) {
      pending.set(path, content)
      clearTimeout(timers.get(path))
      timers.set(path, setTimeout(() => {
        // Serialize writes so a slow earlier save cannot land after a newer one.
        chain = chain.then(() => commit(path)).catch((error) => console.error('autosave failed', error))
      }, delay))
    },

    // Drop a queued write without writing — the file is being deleted or replaced.
    cancel(path) {
      clearTimeout(timers.get(path))
      timers.delete(path)
      pending.delete(path)
    },

    async flush() {
      for (const path of [...pending.keys()]) {
        clearTimeout(timers.get(path))
        await commit(path)
      }
      await chain
    },
  }
}

// DECISION: never beforeunload — iOS Safari does not fire it reliably (§M3).
// pagehide is the backstop for the case where visibilitychange arrives too late.
// shortcut: the flush is async, so a tab torn down within the same tick can lose the last write.
// There is no synchronous OPFS write on the main thread; the window is bounded by the 500ms debounce.
export function installFlushHooks(flush) {
  const run = () => {
    void Promise.resolve(flush()).catch((error) => console.error('flush failed', error))
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') run()
  })
  window.addEventListener('pagehide', run)
}
