import React from 'react'
import { Box, Text, useInput } from 'ink'
import { Menu } from './Menu.tsx'
import { StatusPanel } from './StatusPanel.tsx'
import { LogsPanel } from './LogsPanel.tsx'
import { PromptPanel } from './PromptPanel.tsx'
import { useAppEvents } from './use-app-events.ts'

export function App() {
  const { mode, activeJob, queueCounts, logs, prompt, start, stop, answerPrompt } = useAppEvents()
  const isPromptActive = Boolean(prompt)

  const handleSubmit = (answer: string) => {
    answerPrompt(answer)
  }

  useInput((input, key) => {
    if (key.escape) {
      if (isPromptActive) {
        answerPrompt('')
      } else {
        stop()
      }
      return
    }
    if (isPromptActive) return
    if (input === 'r') start('recent-search')
    if (input === 'f') start('full-search')
    if (input === 'a') start('apply-only')
    if (input === 'x') start('full-run')
    if (input === 's') stop()
  })

  return (
    <Box flexDirection="column" height="100%">
      <Box borderStyle="round" paddingX={1}>
        <Text bold>LinkedIn Auto — mode: {mode}</Text>
      </Box>
      <Box flexDirection="row" flexGrow={1}>
        <Box width="30%" borderStyle="round" paddingX={1}>
          <Menu />
        </Box>
        <Box width="70%" borderStyle="round" paddingX={1}>
          <StatusPanel activeJob={activeJob} queueCounts={queueCounts} />
        </Box>
      </Box>
      <Box height="40%" flexDirection="row">
        <Box width="60%" borderStyle="round" paddingX={1}>
          <LogsPanel logs={logs} />
        </Box>
        <Box width="40%" borderStyle="round" paddingX={1}>
          <PromptPanel prompt={prompt} onSubmit={handleSubmit} />
        </Box>
      </Box>
    </Box>
  )
}
