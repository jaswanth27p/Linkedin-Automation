import React from 'react'
import { Text } from 'ink'

export function Menu() {
  return (
    <Text>
      [r] recent search{'\n'}
      [f] full search{'\n'}
      [a] apply only{'\n'}
      [x] full run (cron){'\n'}
      [s] stop{'\n'}
      [esc] stop / cancel
    </Text>
  )
}
