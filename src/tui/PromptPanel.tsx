import React, { useState } from 'react'
import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'

export function PromptPanel({ prompt, onSubmit }: { prompt: string | null; onSubmit: (answer: string) => void }) {
  const [value, setValue] = useState('')
  if (!prompt) return <Text dimColor>No pending questions</Text>
  return (
    <Box flexDirection="column">
      <Text bold color="yellow">{prompt}</Text>
      <TextInput value={value} onChange={setValue} onSubmit={onSubmit} />
    </Box>
  )
}
