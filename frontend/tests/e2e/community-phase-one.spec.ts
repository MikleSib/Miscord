import { expect, test, type APIRequestContext } from '@playwright/test'

interface SeededAccount {
  username: string
  password: string
  token: string
  serverName: string
}

async function seedCommunity(request: APIRequestContext, projectName: string): Promise<SeededAccount> {
  const suffix = `${projectName.replace(/[^a-z0-9]/gi, '').slice(0, 8)}${Date.now()}${Math.floor(Math.random() * 10_000)}`
  const username = `e2e_${suffix}`.slice(0, 31)
  const password = 'Miscord-e2e-2026!'
  const serverName = `Community ${suffix}`.slice(0, 80)
  const registration = await request.post('/api/v1/auth/register', {
    data: { username, email: `${username}@example.test`, display_name: `E2E ${projectName}`, password },
  })
  expect(registration.ok()).toBeTruthy()

  const login = await request.post('/api/v1/auth/login', {
    form: { username, password },
  })
  expect(login.ok()).toBeTruthy()
  const { access_token: token } = await login.json()
  const headers = { Authorization: `Bearer ${token}` }

  const templates = await request.get('/api/v1/server-templates', { headers })
  expect(templates.ok()).toBeTruthy()
  expect((await templates.json()).builtins).toHaveLength(5)

  const created = await request.post('/api/v1/server-templates/builtin%3Acommunity/create-server', {
    headers,
    data: { name: serverName, description: 'Phase 1 browser contract' },
  })
  expect(created.ok()).toBeTruthy()

  const full = await request.get('/api/v1/channels/full', { headers })
  expect(full.ok()).toBeTruthy()
  const servers = await full.json()
  const server = servers.find((item: { name: string }) => item.name === serverName)
  expect(server).toBeTruthy()
  const textChannel = server.text_channels.find((item: { kind: string }) => item.kind === 'text')
  const forum = server.text_channels.find((item: { kind: string }) => item.kind === 'forum')
  expect(textChannel).toBeTruthy()
  expect(forum).toBeTruthy()

  const thread = await request.post(`/api/v1/channels/${textChannel.id}/threads`, {
    headers,
    data: { name: 'Browser thread', kind: 'private_thread', auto_archive_minutes: 1440 },
  })
  expect(thread.ok()).toBeTruthy()
  expect((await thread.json()).kind).toBe('private_thread')

  const forumSettings = await request.get(`/api/v1/channels/${forum.id}/forum-settings`, { headers })
  expect(forumSettings.ok()).toBeTruthy()
  const forumData = await forumSettings.json()
  const post = await request.post(`/api/v1/channels/${forum.id}/posts`, {
    headers,
    data: {
      title: 'Browser forum post',
      content: 'Created through the public v1 contract.',
      tag_ids: forumData.tags.length ? [forumData.tags[0].id] : [],
    },
  })
  expect(post.ok()).toBeTruthy()

  return { username, password, token, serverName }
}

test('community shell, threads, forum and inbox work across desktop and mobile', async ({ page, request }, testInfo) => {
  const account = await seedCommunity(request, testInfo.project.name)
  await page.goto('/login')
  await page.getByPlaceholder('Ваш логин').fill(account.username)
  await page.getByPlaceholder('Введите пароль').fill(account.password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/app\/?$/)

  await expect(page.getByRole('button', { name: account.serverName })).toBeVisible()
  await page.getByRole('button', { name: account.serverName }).click()
  await expect(page.getByRole('button', { name: 'Открыть уведомления' })).toBeVisible()
  await page.getByRole('button', { name: 'Открыть уведомления' }).click()
  await expect(page.getByRole('heading', { name: 'Входящие' })).toBeVisible()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
