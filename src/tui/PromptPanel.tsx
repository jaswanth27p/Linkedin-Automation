import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'

export function PromptPanel({ prompt, onSubmit }: { prompt: string | null; onSubmit: (answer: string) => void }) {
  const [value, setValue] = useState('')

  useEffect(() => {
    setValue('')
  }, [prompt])

  if (!prompt) return <Text dimColor>No pending questions</Text>

  const handleSubmit = (answer: string) => {
    setValue('')
    onSubmit(answer)
  }

  return (
    <Box flexDirection="column">
      <Text bold color="yellow">{prompt}</Text>
      <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />
    </Box>
  )
}
