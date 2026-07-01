import React from 'react'
import { Text } from 'ink'

export function LogsPanel({ logs }: { logs: string[] }) {
  return <Text>{logs.slice(-12).join('\n')}</Text>
}
