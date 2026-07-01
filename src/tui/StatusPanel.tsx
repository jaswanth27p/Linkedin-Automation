import React from 'react'
import { Text } from 'ink'
import type { AppState } from '../utils/app-events.ts'

type StatusPanelProps = Pick<AppState, 'activeJob' | 'queueCounts'>

export function StatusPanel({ activeJob, queueCounts }: StatusPanelProps) {
  return (
    <Text>
      Active: {activeJob ? `${activeJob.title} @ ${activeJob.company}` : 'none'}{'\n'}
      Search queue: {queueCounts.search}{'\n'}
      Easy apply: {queueCounts.easy}{'\n'}
      External apply: {queueCounts.external}
    </Text>
  )
}
