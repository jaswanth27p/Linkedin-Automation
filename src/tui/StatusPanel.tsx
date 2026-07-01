import React from 'react'
import { Text } from 'ink'

export function StatusPanel({ activeJob, queueCounts }: any) {
  return (
    <Text>
      Active: {activeJob ? `${activeJob.title} @ ${activeJob.company}` : 'none'}{'\n'}
      Search queue: {queueCounts.search}{'\n'}
      Easy apply: {queueCounts.easy}{'\n'}
      External apply: {queueCounts.external}
    </Text>
  )
}
