import { randomUUID } from 'node:crypto'
import { eq, desc, gte, sql } from 'drizzle-orm'
import { getDb } from '../db/index.ts'
import { jobs, applications, searchRuns, answerReviews, careerPages, careerPageScans } from '../db/schema.ts'
import { getApplyQueueCounts } from '../queues/apply-queues.ts'
import { getCurrentConfig } from '../config/current.ts'
import { saveLearnedAnswer } from '../profile/loader.ts'
import { groupAnswersByQuestion, type ApplicationAnswers } from './review-data.ts'
import { logger } from '../utils/logger.ts'

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function page(body: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Application Review</title>
<style>
  :root {
    --bg: #f5f6f8;
    --surface: #ffffff;
    --border: #e1e4e8;
    --text: #1f2328;
    --text-muted: #57606a;
    --accent: #2563eb;
    --accent-hover: #1d4ed8;
    --danger: #b42318;
    --radius: 8px;
  }
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    margin: 0;
    background: var(--bg);
    color: var(--text);
  }
  .page-container { max-width: 960px; margin: 0 auto; padding: 1.5rem 2rem 3rem; }
  nav {
    display: flex;
    gap: 0.25rem;
    padding: 0.75rem 2rem;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  nav a {
    padding: 0.4rem 0.9rem;
    border-radius: var(--radius);
    color: var(--text-muted);
    text-decoration: none;
    font-size: 0.9rem;
    font-weight: 500;
  }
  nav a:hover { background: var(--bg); color: var(--text); }
  h1 { font-size: 1.5rem; margin: 0 0 1rem; }
  section, fieldset {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }
  fieldset { border: 1px solid var(--border); }
  legend { font-weight: 600; padding: 0 0.4rem; }
  table {
    border-collapse: collapse;
    width: 100%;
    background: var(--surface);
    border-radius: var(--radius);
    overflow: hidden;
  }
  th, td { padding: 0.55rem 0.8rem; text-align: left; border-bottom: 1px solid var(--border); }
  th {
    background: var(--bg);
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
    position: sticky;
    top: 0;
  }
  tbody tr:nth-child(even) { background: #fafbfc; }
  tbody tr:hover { background: #f0f4ff; }
  a { color: var(--accent); }
  button, input[type="submit"] {
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: var(--radius);
    padding: 0.45rem 0.9rem;
    font-size: 0.9rem;
    cursor: pointer;
  }
  button:hover { background: var(--accent-hover); }
  input[type="text"] {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.4rem 0.6rem;
    font-size: 0.9rem;
  }
  .error-banner {
    background: #fdecea;
    border: 1px solid #f5b5ac;
    color: var(--danger);
    border-radius: var(--radius);
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
  }
  .reference-block { color: var(--text-muted); font-size: 0.9rem; margin: 0.5rem 0; }
</style>
</head><body>
<nav><a href="/">Summary</a><a href="/applications">Applications</a><a href="/external-jobs">External Jobs</a><a href="/review">Review</a><a href="/career-pages">Career Pages</a></nav>
<div class="page-container">${body}</div>
</body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

async function renderSummary(): Promise<Response> {
  const db = getDb()
  const since = startOfToday()

  const todayRuns = await db.select().from(searchRuns).where(gte(searchRuns.startedAt, since))
  const scanned = todayRuns.reduce((sum, r) => sum + r.scannedCount, 0)
  const found = todayRuns.reduce((sum, r) => sum + r.relevantCount, 0)

  const todayApps = await db.select().from(applications).where(gte(applications.createdAt, since))
  const applied = todayApps.filter((a) => a.status === 'applied').length
  const failed = todayApps.filter((a) => a.status === 'failed').length

  const easyCounts = await getApplyQueueCounts()

  return page(`
    <h1>Today</h1>
    <p>Search: ${scanned} scanned, ${found} found (${todayRuns.length} run(s))</p>
    <p>Applications: ${applied} applied, ${failed} failed</p>
    <p>Easy Apply queue: ${easyCounts.waiting} waiting / ${easyCounts.active} active</p>
  `)
}

const SOURCE_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  career_page: 'Career Page',
}

async function renderApplications(): Promise<Response> {
  const db = getDb()
  const rows = await db
    .select({
      status: applications.status,
      answers: applications.answers,
      createdAt: applications.createdAt,
      jobTitle: jobs.title,
      company: jobs.company,
      source: jobs.source,
    })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .orderBy(desc(applications.createdAt))
    .limit(200)

  const items = rows
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.jobTitle)}</td>
      <td>${escapeHtml(r.company)}</td>
      <td>${SOURCE_LABELS[r.source] ?? r.source}</td>
      <td>${r.status}</td>
      <td>${r.answers.length} answer(s)</td>
      <td>${r.createdAt?.toISOString() ?? ''}</td>
    </tr>`,
    )
    .join('')

  return page(
    `<h1>Applications</h1><table><tr><th>Job</th><th>Company</th><th>Source</th><th>Status</th><th>Answers</th><th>When</th></tr>${items}</table>`,
  )
}

async function renderExternalJobs(): Promise<Response> {
  const db = getDb()
  const rows = await db
    .select({
      title: jobs.title,
      company: jobs.company,
      applyUrl: jobs.applyUrl,
      source: jobs.source,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .where(eq(jobs.status, 'external_saved'))
    .orderBy(desc(jobs.createdAt))
    .limit(200)

  const items = rows
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.title)}</td>
      <td>${escapeHtml(r.company)}</td>
      <td>${SOURCE_LABELS[r.source] ?? r.source}</td>
      <td><a href="${escapeHtml(r.applyUrl)}">${escapeHtml(r.applyUrl)}</a></td>
      <td>${r.createdAt?.toISOString() ?? ''}</td>
    </tr>`,
    )
    .join('')

  return page(
    `<h1>External Jobs</h1><table><tr><th>Job</th><th>Company</th><th>Source</th><th>Apply link</th><th>Found</th></tr>${items}</table>${
      rows.length === 0 ? '<p>No external jobs saved yet.</p>' : ''
    }`,
  )
}

async function renderCareerPages(): Promise<Response> {
  const db = getDb()
  const rows = await db
    .select({
      url: careerPages.url,
      label: careerPages.label,
      addedAt: careerPages.addedAt,
      lastCheckedAt: careerPages.lastCheckedAt,
      relevantFound: sql<number>`coalesce(sum(${careerPageScans.relevantCount}), 0)`,
    })
    .from(careerPages)
    .leftJoin(careerPageScans, eq(careerPageScans.careerPageId, careerPages.id))
    .groupBy(careerPages.id)
    .orderBy(careerPages.addedAt)

  const items = rows
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.label)}</td>
      <td><a href="${escapeHtml(r.url)}">${escapeHtml(r.url)}</a></td>
      <td>${r.lastCheckedAt?.toISOString() ?? 'never'}</td>
      <td>${r.relevantFound}</td>
    </tr>`,
    )
    .join('')

  return page(
    `<h1>Career Pages</h1><table><tr><th>Label</th><th>URL</th><th>Last checked</th><th>Relevant found (all time)</th></tr>${items}</table>${
      rows.length === 0 ? '<p>No career pages tracked yet — use /add-career-url.</p>' : ''
    }`,
  )
}

async function renderReview(): Promise<Response> {
  const db = getDb()
  const rows = await db
    .select({ jobId: applications.jobId, answers: applications.answers, jobTitle: jobs.title, company: jobs.company })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))

  const grouped = groupAnswersByQuestion(rows as ApplicationAnswers[])

  const items = grouped
    .map(
      (g) => `
    <fieldset>
      <legend>${escapeHtml(g.question)}</legend>
      ${g.variants
        .map(
          (v) => `
        <div>
          <p>${escapeHtml(v.answer)} <small>(${v.jobs.length} application(s))</small></p>
          <form method="post" action="/review/feedback">
            <input type="hidden" name="question" value="${escapeHtml(g.question)}" />
            <input type="hidden" name="answer" value="${escapeHtml(v.answer)}" />
            <button name="verdict" value="correct">Correct</button>
            <input type="text" name="note" placeholder="corrected answer (if wrong)" />
            <button name="verdict" value="wrong">Wrong</button>
          </form>
        </div>`,
        )
        .join('')}
    </fieldset>`,
    )
    .join('')

  return page(`<h1>Review</h1>${items || '<p>No answers recorded yet.</p>'}`)
}

async function handleFeedback(req: Request): Promise<Response> {
  const form = await req.formData()
  const question = String(form.get('question') ?? '')
  const answer = String(form.get('answer') ?? '')
  const verdict = String(form.get('verdict') ?? '')
  const note = form.get('note') ? String(form.get('note')) : undefined

  if (!question || !answer || (verdict !== 'correct' && verdict !== 'wrong')) {
    return new Response('bad request', { status: 400 })
  }

  const db = getDb()
  await db.insert(answerReviews).values({ id: randomUUID(), question, answer, verdict, note: note ?? null })

  if (verdict === 'wrong' && note) {
    const config = getCurrentConfig()
    await saveLearnedAnswer(config.profileFiles.profile, question, note)
    logger.info({ question, note }, 'dashboard: corrected learned answer')
  }

  return new Response(null, { status: 303, headers: { Location: '/review' } })
}

export async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url)
  if (req.method === 'GET' && url.pathname === '/') return renderSummary()
  if (req.method === 'GET' && url.pathname === '/applications') return renderApplications()
  if (req.method === 'GET' && url.pathname === '/external-jobs') return renderExternalJobs()
  if (req.method === 'GET' && url.pathname === '/review') return renderReview()
  if (req.method === 'GET' && url.pathname === '/career-pages') return renderCareerPages()
  if (req.method === 'POST' && url.pathname === '/review/feedback') return handleFeedback(req)
  return new Response('not found', { status: 404 })
}

let server: ReturnType<typeof Bun.serve> | null = null

export function startDashboard(): void {
  if (server) return
  const port = Number(process.env.DASHBOARD_PORT) || 4870
  try {
    // Bind loopback only — this serves the user's application history and
    // personal answers; it must never be reachable from the LAN.
    server = Bun.serve({ port, hostname: '127.0.0.1', fetch: handleRequest })
    logger.info({ port }, 'dashboard: listening')
  } catch (err) {
    // A busy port must not take the whole app down — the dashboard is optional.
    logger.error({ err, port }, 'dashboard: failed to start (port in use?) — continuing without it')
  }
}

export function stopDashboard(): void {
  server?.stop(true)
  server = null
}
