import { readFile, writeFile } from 'node:fs/promises'
import { profileSchema, type ProfileData } from './profile.schema.ts'

export async function loadResume(path: string): Promise<string> {
  return readFile(path, 'utf-8')
}

export async function loadProfile(path: string): Promise<ProfileData> {
  const raw = await readFile(path, 'utf-8')
  return profileSchema.parse(JSON.parse(raw))
}

export async function saveLearnedAnswer(path: string, question: string, answer: string): Promise<void> {
  const profile = await loadProfile(path)
  profile.answers[question] = answer
  await writeFile(path, JSON.stringify(profile, null, 2))
}
