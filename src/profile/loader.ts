import { readFileSync } from 'node:fs'

export async function loadProfileText(path: string): Promise<string> {
  return readFileSync(path, 'utf-8')
}
