import { describe, test, expect } from 'bun:test'
import { buildNotification } from '../../../src/notify/notify.ts'

describe('buildNotification', () => {
  test('external-job-found includes title, company, and the apply URL as the click target', () => {
    const built = buildNotification({
      kind: 'external-job-found',
      title: 'Senior Engineer',
      company: 'Acme',
      applyUrl: 'https://acme.com/careers/123',
    })
    expect(built.title).toBe('External job: Senior Engineer @ Acme')
    expect(built.message).toBe('https://acme.com/careers/123')
    expect(built.openUrl).toBe('https://acme.com/careers/123')
  })

  test('needs-input includes the tab label and question, no openUrl', () => {
    const built = buildNotification({ kind: 'needs-input', tab: 'easy', question: 'What is your notice period?' })
    expect(built.title).toBe('Easy Apply needs your input')
    expect(built.message).toBe('What is your notice period?')
    expect(built.openUrl).toBeUndefined()
  })

  test('needs-input uses the right label per tab', () => {
    expect(buildNotification({ kind: 'needs-input', tab: 'search', question: 'q' }).title).toBe('Search needs your input')
    expect(buildNotification({ kind: 'needs-input', tab: 'careers', question: 'q' }).title).toBe('Career Pages needs your input')
  })

  test('easy-apply-result success', () => {
    const built = buildNotification({ kind: 'easy-apply-result', success: true, title: 'Engineer', company: 'Acme' })
    expect(built.title).toBe('Applied')
    expect(built.message).toBe('Engineer @ Acme')
    expect(built.openUrl).toBeUndefined()
  })

  test('easy-apply-result failure includes the error', () => {
    const built = buildNotification({
      kind: 'easy-apply-result',
      success: false,
      title: 'Engineer',
      company: 'Acme',
      error: 'form crashed',
    })
    expect(built.title).toBe('Application failed')
    expect(built.message).toBe('Engineer @ Acme — form crashed')
  })

  test('easy-apply-result failure with no error message uses a fallback', () => {
    const built = buildNotification({ kind: 'easy-apply-result', success: false, title: 'Engineer', company: 'Acme' })
    expect(built.message).toBe('Engineer @ Acme — unknown error')
  })
})
