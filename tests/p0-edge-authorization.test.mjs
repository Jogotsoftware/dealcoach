// Node-only execution of the real Edge handlers with inert Supabase/HTTP adapters.
// No database, Deno installation, network, auth-user creation or LLM calls.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { transform } from 'esbuild'

async function handler(name, fixture = {}) {
  let run
  const calls = []
  const record = (kind, table) => calls.push({ kind, table })
  const service = {
    from(table) {
      let mutation = false
      const query = {
        select() { return query }, eq() { return query },
        update() { mutation = true; record('write', table); return query },
        upsert() { mutation = true; record('write', table); return query },
        async single() { return result() }, async maybeSingle() { return result() },
        then(resolve, reject) { return Promise.resolve().then(result).then(resolve, reject) },
      }
      function result() {
        if (fixture.throwOn === table) throw new Error('Injected read failure')
        if (mutation) return { data: null, error: null }
        record('read', table)
        const rows = {
          profiles: fixture.profile === undefined ? { org_id: 'org-a', role: 'rep' } : fixture.profile,
          quotes: fixture.quote || { id: 'quote-a', org_id: 'org-a', deal_id: 'deal-a' },
          sow_documents: fixture.sow || { id: 'sow-a', org_id: 'org-a', deal_id: 'deal-a', storage_path: 'deal-a/sow/file.pdf' },
          deals: fixture.deal || { org_id: 'org-a' },
          invitations: { id: 'inv-a', invitation_type: 'teammate', status: 'pending', email: 'rep@example.test', ...fixture.invitation },
        }
        return { data: rows[table], error: null }
      }
      return query
    },
    storage: { from: () => ({ download: async () => { record('download'); return { data: null, error: { message: 'Test stops at download' } } } }) },
    auth: { admin: {
      listUsers: async () => { record('auth-admin'); throw new Error('Test stops at auth administration') },
      createUser: async () => { record('auth-admin') }, updateUserById: async () => { record('auth-admin') },
    } },
    rpc: async () => { record('rpc'); return { data: [{ success: true }] } },
  }
  const createClient = (_url, key, options) => {
    if (key === 'service-key') return service
    record('user-client')
    assert.equal(options.global.headers.Authorization, fixture.authorization ?? 'Bearer user-token')
    return { auth: { getUser: async () => fixture.invalidToken ? { data: {}, error: { message: 'Invalid JWT' } } : { data: { user: { id: 'user-a' } }, error: null } } }
  }
  const raw = await readFile(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8')
  const source = raw.replace(/^import .*\n/gm, '')
  const { code } = await transform(source, { loader: 'ts', format: 'cjs' })
  const context = vm.createContext({
    createClient, serve: fn => { run = fn },
    Deno: { env: { get: key => ({ SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUPABASE_ANON_KEY: 'anon-key', ANTHROPIC_API_KEY: 'unused' })[key] }, serve: fn => { run = fn } },
    Response, Request, console: { log() {}, error() {} },
  })
  vm.runInContext(code, context)
  const payload = name === 'create-invited-user' ? { token: 'test-token', password: 'unused-password', full_name: 'Test User' }
    : name === 'import-sow' ? { sow_document_id: 'sow-a' } : { quote_id: 'quote-a', storage_path: fixture.storagePath || 'org-a/quote-a/file.pdf' }
  const headers = { 'Content-Type': 'application/json' }
  if (!fixture.noToken) headers.Authorization = fixture.authorization ?? 'Bearer user-token'
  const response = await run(new Request('https://example.invalid', { method: 'POST', headers, body: JSON.stringify(payload) }))
  return { response, calls }
}
const noSideEffects = calls => assert.deepEqual(calls.filter(c => ['write', 'auth-admin', 'rpc', 'download'].includes(c.kind)), [])

for (const name of ['import-order-schedule', 'import-sow']) {
  for (const [scenario, fixture, status] of [
    ['missing JWT', { noToken: true }, 401],
    ['invalid JWT', { invalidToken: true }, 401],
    ['service key is not a user JWT', { authorization: 'Bearer service-key', invalidToken: true }, 401],
    ['foreign org', { profile: { org_id: 'org-b', role: 'rep' } }, 403],
    ['same-org BDR', { profile: { org_id: 'org-a', role: 'bdr' } }, 403],
    ['missing profile', { profile: null }, 403],
    ['orgless profile', { profile: { org_id: null, role: 'rep' } }, 403],
    ['thrown profile read', { throwOn: 'profiles' }, 500],
  ]) {
    test(`${name}: ${scenario} has no side effects`, async () => {
      const { response, calls } = await handler(name, fixture)
      assert.equal(response.status, status)
      noSideEffects(calls)
      if (status === 401) assert.equal(calls.some(c => c.kind === 'read'), false)
    })
  }
  test(`${name}: same-org rep reaches existing import path`, async () => {
    const { calls } = await handler(name)
    assert.equal(calls.some(c => c.kind === 'download'), true)
  })
}
test('order schedule rejects foreign-org source path', async () => {
  const { response, calls } = await handler('import-order-schedule', { storagePath: 'org-b/input.pdf' })
  assert.equal(response.status, 403); noSideEffects(calls)
})
for (const [scenario, fixture] of [
  ['foreign deal', { deal: { org_id: 'org-b' } }],
  ['foreign quote', { sow: { id: 'sow-a', org_id: 'org-a', deal_id: 'deal-a', quote_id: 'quote-b', storage_path: 'deal-a/sow/file.pdf' }, quote: { org_id: 'org-b', deal_id: 'deal-a' } }],
  ['foreign file', { sow: { id: 'sow-a', org_id: 'org-a', deal_id: 'deal-a', storage_path: 'deal-b/file.pdf' } }],
]) test(`SOW rejects ${scenario} before status updates`, async () => {
  const { response, calls } = await handler('import-sow', fixture)
  assert.equal(response.status, 403); noSideEffects(calls)
})
for (const invitation of [
  { invitation_type: 'partner' }, { invitation_type: null }, { invitation_type: 'future_type' },
  { target_app: 'evaluation_room' }, { invitation_type: 'new_instance', target_app: 'evaluation_room' },
]) test(`signup refuses ${JSON.stringify(invitation)} before auth or profile mutation`, async () => {
  const { response, calls } = await handler('create-invited-user', { invitation })
  assert.equal(response.status, 400)
  assert.equal((await response.json()).error, 'This invitation cannot be accepted here.')
  noSideEffects(calls)
})
for (const invitation_type of ['teammate', 'new_instance']) test(`signup allows ${invitation_type} without target_app to reach existing signup path`, async () => {
  const { calls } = await handler('create-invited-user', { invitation: { invitation_type } })
  assert.equal(calls.some(c => c.kind === 'auth-admin'), true)
})
