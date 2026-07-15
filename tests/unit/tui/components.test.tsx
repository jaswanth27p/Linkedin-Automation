import { describe, test, expect, beforeEach } from 'bun:test'
import { testRender } from '@opentui/solid'
import { initAppState, setSessionStatus, setNeedsInput, pushLog } from '../../../src/state/app-state.ts'
import { Header } from '../../../src/tui/components/Header.tsx'
import { Sidebar } from '../../../src/tui/components/Sidebar.tsx'
import { LogPanel } from '../../../src/tui/components/LogPanel.tsx'

beforeEach(() => {
  initAppState({ concurrency: 1, model: 'test', irrelevantBailRatio: 0.5, maxJobsPerRun: 25, minNavDelayMs: 3000, maxNavDelayMs: 8000 })
})

describe('TUI components', () => {
  test('Header shows waiting state, then connected state', async () => {
    const setup = await testRender(() => <Header />, { width: 60, height: 5 })
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain('Waiting for login')

    setSessionStatus('linkedin', true)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain('connected')
  })

  test('Sidebar highlights a tab with a pending question', async () => {
    setNeedsInput('easy', 'What is your notice period?')
    const setup = await testRender(() => <Sidebar />, { width: 30, height: 20 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain('needs_input')
    // Sidebar is narrow enough that long questions wrap across lines — assert
    // on a short, guaranteed-unwrapped prefix rather than the full sentence.
    expect(frame).toContain('What is your notice')
  })

  test('LogPanel renders only the given tab\'s log lines', async () => {
    pushLog('search', 'scanning linkedin.com/jobs')
    pushLog('easy', 'applying to job 1')
    const setup = await testRender(() => <LogPanel tab="search" />, { width: 60, height: 10 })
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain('scanning linkedin.com/jobs')
    expect(frame).not.toContain('applying to job 1')
  })
})
