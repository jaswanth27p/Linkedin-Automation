// Stub: mastra module will be implemented in Task 5
export interface Page {
  screenshot(options: { path: string }): Promise<void>
}

export async function getBrowserPage(): Promise<Page> {
  throw new Error('getBrowserPage not implemented - mastra module will be ready in Task 5')
}
