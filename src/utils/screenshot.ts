import { getBrowserPage } from '../mastra/index.ts'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { logger } from './logger.ts'

export async function takeScreenshot(path: string) {
  try {
    await mkdir(dirname(path), { recursive: true })
    const page = await getBrowserPage()
    await page.screenshot({ path })
  } catch (err) {
    logger.error({ err, path }, 'screenshot failed')
    throw err
  }
}
