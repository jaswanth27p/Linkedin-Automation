import { describe, test, expect } from 'bun:test'
import { loadConfig } from '../../../src/config/loader.ts'

describe('loadConfig', () => {
  test('loads and validates sample config', async () => {
    const config = await loadConfig('./linkedin-auto.config.ts')
    // Asserts non-empty rather than an exact count — mustCheckUrls is the
    // user's own live, editable search-URL list, not fixed sample data, so
    // pinning an exact length here breaks the test every time someone adds
    // or removes a URL from their own config.
    expect(config.mustCheckUrls.length).toBeGreaterThan(0)
    expect(config.requirements).toContain('remote')
    expect(config.profileFiles.resume).toBe('./resume.md')
    expect(config.profileFiles.profile).toBe('./profile.json')
  })

  test('rejects config missing requirements', async () => {
    await expect(
      import('../../../src/config/schema.ts').then(({ appConfigSchema }) =>
        appConfigSchema.parse({
          mustCheckUrls: ['https://example.com'],
          profileFiles: { resume: './resume.md', profile: './profile.json' },
        }),
      ),
    ).rejects.toThrow()
  })

  test('accepts an optional resumeFile path', async () => {
    const config = await loadConfig('./linkedin-auto.config.ts')
    // Not set in the tracked sample config — must not be required.
    expect(config.profileFiles.resumeFile).toBeUndefined()
  })
})
