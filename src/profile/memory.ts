import { getDb } from '../db/index.ts'
import { memoryFacts } from '../db/schema.ts'

export async function rememberFact(question: string, answer: string) {
  const db = getDb()
  await db.insert(memoryFacts).values({
    id: crypto.randomUUID(),
    question,
    answer,
  })
}

export async function getFactsText(): Promise<string> {
  const db = getDb()
  const facts = await db.select().from(memoryFacts)
  if (facts.length === 0) return ''
  return facts.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n---\n')
}
