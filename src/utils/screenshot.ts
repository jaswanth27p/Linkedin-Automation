import { browser } from '../mastra/index.ts'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export async function takeScreenshot(path: string) {
  mkdirSync(dirname(path), { recursive: true })
  const page = await (browser as any).getPage()
  await page.screenshot({ path })
}
