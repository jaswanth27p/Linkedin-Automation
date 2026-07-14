export async function verifyLogin(serverPort: number): Promise<{ linkedin: boolean }> {
  const res = await fetch(
    `http://127.0.0.1:${serverPort}/page-url?tab=0`
  ).then(r => r.json()).catch(() => ({ url: '' }))

  const pageUrl = (res.url || '').toLowerCase()
  const loggedIn =
    pageUrl.includes('linkedin.com/feed') ||
    pageUrl.includes('linkedin.com/mynetwork') ||
    pageUrl.includes('linkedin.com/jobs') ||
    pageUrl.includes('linkedin.com/messaging') ||
    pageUrl.includes('linkedin.com/notifications') ||
    (pageUrl.includes('linkedin.com') && !pageUrl.includes('/login') && !pageUrl.includes('/checkpoint'))

  return { linkedin: loggedIn }
}
