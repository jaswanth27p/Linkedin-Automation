import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  company: text('company').notNull(),
  location: text('location'),
  applyUrl: text('apply_url').notNull(),
  applyType: text('apply_type', { enum: ['easy', 'external'] }).notNull(),
  sourceUrl: text('source_url').notNull(),
  status: text('status', { enum: ['discovered', 'queued', 'needs_input', 'applied', 'failed'] }).notNull().default('discovered'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
})

export const applications = sqliteTable('applications', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull().references(() => jobs.id),
  status: text('status', { enum: ['applied', 'failed', 'needs_input'] }).notNull(),
  result: text('result'),
  screenshotPath: text('screenshot_path'),
  error: text('error'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
})

export const memoryFacts = sqliteTable('memory_facts', {
  id: text('id').primaryKey(),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
})
