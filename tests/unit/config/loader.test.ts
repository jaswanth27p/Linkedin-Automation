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

  test('defaults notifySummaryIntervalMinutes to 30 when not set', async () => {
    const { appConfigSchema } = await import('../../../src/config/schema.ts')
    const config = appConfigSchema.parse({
      mustCheckUrls: ['https://example.com'],
      requirements: 'remote',
      profileFiles: { resume: './resume.md', profile: './profile.json' },
    })
    expect(config.notifySummaryIntervalMinutes).toBe(30)
  })
})
