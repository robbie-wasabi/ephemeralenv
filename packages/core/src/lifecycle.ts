export function createCleanup(tasks: Array<() => Promise<void>>): () => Promise<void> {
  let cleanupPromise: Promise<void> | undefined

  return async () => {
    cleanupPromise ??= runCleanup(tasks)
    await cleanupPromise
  }
}

async function runCleanup(tasks: Array<() => Promise<void>>): Promise<void> {
  const errors: unknown[] = []

  for (const task of [...tasks].reverse()) {
    try {
      await task()
    } catch (error) {
      errors.push(error)
    }
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, 'Cleanup failed')
  }
}
