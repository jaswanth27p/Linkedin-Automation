export class NeedsInputError extends Error {
  constructor(public question: string) {
    super(`NEEDS_INPUT: ${question}`)
  }
}
