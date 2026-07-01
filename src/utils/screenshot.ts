import { browser } from '../mastra/index.ts'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { logger } from './logger.ts'

export async function takeScreenshot(path: string) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    const page = await (browser as any).getPage()
    await page.screenshot({ path })
  } catch (err) {
    logger.error({ err, path }, 'screenshot failed')
    throw err
  }
}
