export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Words common enough to dominate token overlap between genuinely different
// questions (e.g. "Are you willing to relocate?" vs "...to travel?" share
// every word except the one that actually matters) — stripped before fuzzy
// scoring so the score reflects content words, not sentence scaffolding.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'have', 'has', 'had',
  'you', 'your', 'yours', 'i', 'my', 'me', 'we', 'our', 'it', 'its',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'about', 'as', 'by',
  'and', 'or', 'if', 'so', 'not', 'no', 'yes',
  'will', 'would', 'can', 'could', 'should', 'shall', 'may', 'might', 'must',
  'please', 'kindly',
])

function tokenSet(text: string): Set<string> {
  return new Set(normalize(text).split(' ').filter((t) => t && !STOPWORDS.has(t)))
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

export const FUZZY_MATCH_THRESHOLD = 0.6

/**
 * Looks up a previously-learned answer for a question, tolerating rewording:
 * exact match (normalized) first, then the closest token-overlap match above
 * FUZZY_MATCH_THRESHOLD.
 */
export function findLearnedAnswer(question: string, answers: Record<string, string>): string | null {
  const normalizedQuestion = normalize(question)
  if (!normalizedQuestion) return null

  for (const [key, value] of Object.entries(answers)) {
    if (normalize(key) === normalizedQuestion) return value
  }

  const questionTokens = tokenSet(question)
  let best: { value: string; score: number } | null = null
  for (const [key, value] of Object.entries(answers)) {
    const score = jaccardSimilarity(questionTokens, tokenSet(key))
    if (score >= FUZZY_MATCH_THRESHOLD && (!best || score > best.score)) {
      best = { value, score }
    }
  }
  return best?.value ?? null
}
