import { describe, test, expect, mock } from 'bun:test'

// Custom mocks isolated to this test file
let capturedClickCallback: ((event?: any) => void) | undefined

mock.module('node-notifier', () => ({
  default: {
    notify: () => {
      // Success - don't throw, allowing the click handler registration to proceed
    },
    once: (event: string, callback: (event?: any) => void) => {
      if (event === 'click') {
        capturedClickCallback = callback
      }
    },
  },
}))

mock.module('open', () => ({
  default: async () => {
    throw new Error('no default browser configured')
  },
}))

const { notify } = await import('../../../src/notify/notify.ts')

describe('notify click handler rejection path', () => {
  test('open() rejection in click handler is caught without throwing or unhandled rejection', async () => {
    // Reset state for this test
    capturedClickCallback = undefined

    // Call notify with an event that has an openUrl
    notify({
      kind: 'external-job-found',
      title: 'Engineer',
      company: 'Acme',
      applyUrl: 'https://acme.com/jobs/1',
    })

    // Verify the click handler was registered
    expect(capturedClickCallback).toBeDefined()
    expect(typeof capturedClickCallback).toBe('function')

    // Invoke the click handler manually - it should not throw synchronously
    // (The async rejection from open() is handled by the .catch() block in notify.ts)
    expect(() => {
      capturedClickCallback!()
    }).not.toThrow()

    // Give any pending promise microtasks a chance to settle.
    // If there were an unhandled promise rejection, it would manifest as:
    // - An unhandledRejection event (which bun test catches and reports)
    // - A console error/warning
    // We await a microtask to ensure the .catch() handler runs.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})
