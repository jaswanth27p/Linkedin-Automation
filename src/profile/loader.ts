import { readFileSync } from 'node:fs'
import type { AppConfig } from '../config/schema.ts'
import { getFactsText } from './memory.ts'

export async function loadProfileText(path: string): Promise<string> {
  return readFileSync(path, 'utf-8')
}

export async function buildProfileText(config: AppConfig): Promise<string> {
  const profile = await loadProfileText(config.profileFiles.profile)
  const facts = await getFactsText()
  const parts = [profile]
  if (facts) {
    parts.push('Learned answers:', facts)
  }
  parts.push('Resume path:', config.profileFiles.resume)
  return parts.join('\n\n')
}
