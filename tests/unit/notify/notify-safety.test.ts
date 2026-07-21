import { describe, test, expect, mock } from 'bun:test'

mock.module('node-notifier', () => ({
  default: {
    notify: () => {
      throw new Error('no notification daemon on this machine')
    },
    once: () => {},
  },
}))

mock.module('open', () => ({
  default: async () => {
    throw new Error('no default browser configured')
  },
}))

const { notify } = await import('../../../src/notify/notify.ts')

describe('notify', () => {
  test('never throws even when node-notifier itself throws', () => {
    expect(() => notify({ kind: 'needs-input', tab: 'search', question: 'q' })).not.toThrow()
  })

  test('never throws for an external-job-found event either', () => {
    expect(() =>
      notify({ kind: 'external-job-found', title: 'Engineer', company: 'Acme', applyUrl: 'https://acme.com/jobs/1' }),
    ).not.toThrow()
  })
})
