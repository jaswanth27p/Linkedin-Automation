/**
 * Mastra auto-attaches a BrowserContextProcessor to any Agent configured with
 * `browser`, and that processor's computeStateSignal() hard-requires Mastra
 * memory plus an active resourceId/threadId per call — infra we don't need
 * for one-shot agent runs. Mastra skips auto-adding it if a processor with
 * the same id is already present in `inputProcessors` (confirmed against
 * @mastra/core's getInputProcessors() source), so this no-op stands in for it.
 */
import type { ProcessInputArgs, ProcessInputResult } from '@mastra/core/processors'

export const noOpBrowserContextProcessor = {
  id: 'browser-context' as const,
  processInput: (args: ProcessInputArgs): ProcessInputResult => args.messageList,
}
