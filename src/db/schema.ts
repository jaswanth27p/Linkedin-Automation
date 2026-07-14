import { pgTable, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core'

export const jobs = pgTable('jobs', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  company: text('company').notNull(),
  location: text('location'),
  applyUrl: text('apply_url').notNull(),
  applyType: text('apply_type', { enum: ['easy', 'external'] }).notNull(),
  sourceUrl: text('source_url').notNull(),
  status: text('status', {
    enum: ['discovered', 'queued', 'needs_input', 'applied', 'failed', 'skipped'],
  }).notNull().default('discovered'),
  relevanceReason: text('relevance_reason'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const applications = pgTable('applications', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull().references(() => jobs.id),
  status: text('status', { enum: ['applied', 'failed', 'needs_input'] }).notNull(),
  result: text('result'),
  screenshotPath: text('screenshot_path'),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow(),
})

export const searchRuns = pgTable('search_runs', {
  id: text('id').primaryKey(),
  startedAt: timestamp('started_at').defaultNow(),
  finishedAt: timestamp('finished_at'),
  urlsTried: jsonb('urls_tried').$type<string[]>().notNull().default([]),
  scannedCount: integer('scanned_count').notNull().default(0),
  relevantCount: integer('relevant_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
})
