import { describe, test, expect, mock } from 'bun:test'

const calls: unknown[] = []
mock.module('../../../src/notify/notify.ts', () => ({
  notify: (event: unknown) => calls.push(event),
}))

// Dynamic import, after mock.module — this file must not have a static
// top-level import of prompt-channel.ts, or it (and its own static import of
// notify.ts) would already be bound to the real notify before the mock lands.
const { waitForAnswer, answerPrompt } = await import('../../../src/state/prompt-channel.ts')

describe('prompt-channel notifications', () => {
  test('waitForAnswer fires a needs-input notification', async () => {
    const promise = waitForAnswer('easy', 'Notice period?')
    answerPrompt('easy', '2 weeks')
    await promise

    expect(calls).toEqual([{ kind: 'needs-input', tab: 'easy', question: 'Notice period?' }])
  })
})
