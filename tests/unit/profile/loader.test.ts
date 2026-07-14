import { describe, test, expect, afterEach, beforeEach } from 'bun:test'
import { writeFileSync, readFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadResume, loadProfile, saveLearnedAnswer } from '../../../src/profile/loader.ts'

let dir: string
let profilePath: string
let resumePath: string

const sampleProfile = {
  contact: { email: 'jaswanthjas20@gmail.com', phone: '555-0100', location: 'Remote' },
  workAuth: { authorized: true, requiresSponsorship: false },
  experienceYears: 5,
  salaryExpectation: { min: 120000, max: 160000, currency: 'USD' },
  links: { linkedin: '', github: '', portfolio: '' },
  answers: {},
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'profile-test-'))
  profilePath = path.join(dir, 'profile.json')
  resumePath = path.join(dir, 'resume.md')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('profile loader', () => {
  test('loadResume reads free text', async () => {
    writeFileSync(resumePath, '# Resume\n\nSenior Engineer.')
    const text = await loadResume(resumePath)
    expect(text).toContain('Senior Engineer')
  })

  test('loadProfile parses and validates profile.json', async () => {
    writeFileSync(profilePath, JSON.stringify(sampleProfile))
    const profile = await loadProfile(profilePath)
    expect(profile.contact.email).toBe('jaswanthjas20@gmail.com')
    expect(profile.experienceYears).toBe(5)
  })

  test('loadProfile rejects invalid profile.json', async () => {
    writeFileSync(profilePath, JSON.stringify({ contact: {} }))
    await expect(loadProfile(profilePath)).rejects.toThrow()
  })

  test('saveLearnedAnswer appends and persists a Q&A pair', async () => {
    writeFileSync(profilePath, JSON.stringify(sampleProfile))
    await saveLearnedAnswer(profilePath, 'Are you willing to relocate?', 'No')
    const onDisk = JSON.parse(readFileSync(profilePath, 'utf-8'))
    expect(onDisk.answers['Are you willing to relocate?']).toBe('No')
  })
})
