import { test, expect, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { App } from '../../../src/tui/App.tsx'

vi.mock('../../../src/tui/use-app-events.ts', () => ({
  useAppEvents: () => ({
    mode: 'idle',
    activeJob: null,
    queueCounts: { search: 0, easy: 0, external: 0 },
    logs: ['ready'],
    prompt: null,
    start: vi.fn(),
    stop: vi.fn(),
    answerPrompt: vi.fn(),
  }),
}))

test('renders main layout', () => {
  const { lastFrame } = render(<App />)
  expect(lastFrame()).toContain('LinkedIn Auto')
})
