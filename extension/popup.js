const SUPABASE_URL = 'https://npfnsyufqqhhjmtvmold.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5wZm5zeXVmcXFoaGptdHZtb2xkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4Nzc1NzgsImV4cCI6MjA4OTQ1MzU3OH0.2KpF_ATKJiJP7wEfD74GIOXALhitu7GHavj8CL9OtGU'
const WEB_APP_URL = 'https://dealcoach.netlify.app'
const EDGE_URL = SUPABASE_URL + '/functions/v1'

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
let user = null, profile = null

const d3 = new Date(); d3.setMonth(d3.getMonth() + 3)
document.getElementById('closeDate').value = d3.toISOString().split('T')[0]

async function init() {
  try {
    const stored = await chrome.storage.local.get(['dc_access', 'dc_refresh'])
    if (stored.dc_access && stored.dc_refresh) {
      try {
        const { data } = await sb.auth.setSession({ access_token: stored.dc_access, refresh_token: stored.dc_refresh })
        if (data?.session) { user = data.session.user; await loadProfile(); showForm(); readPage(); return }
      } catch (e) { console.log('Stored session invalid:', e) }
    }
  } catch (e) { console.log('Storage error:', e) }
  showLogin()
}

async function loadProfile() {
  const { data } = await sb.from('profiles').select('*').eq('id', user.id).single()
  profile = data || {}
}

function showLogin() {
  document.getElementById('loginView').style.display = 'block'
  document.getElementById('formView').style.display = 'none'
  document.getElementById('statusBadge').textContent = 'Not signed in'
  document.getElementById('statusBadge').className = 'badge badge-red'
}

function showForm() {
  document.getElementById('loginView').style.display = 'none'
  document.getElementById('formView').style.display = 'block'
  document.getElementById('statusBadge').textContent = profile?.initials || 'OK'
  document.getElementById('statusBadge').className = 'badge badge-green'
}

function esc(s) { const el = document.createElement('div'); el.textContent = s; return el.innerHTML }

document.getElementById('loginBtn').addEventListener('click', async () => {
  const email = document.getElementById('loginEmail').value
  const pw = document.getElementById('loginPassword').value
  const err = document.getElementById('loginError')
  const btn = document.getElementById('loginBtn')
  if (!email || !pw) { err.textContent = 'Enter email and password'; err.style.display = 'block'; return }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Signing in...'
  err.style.display = 'none'
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pw })
    if (error) { err.textContent = error.message; err.style.display = 'block'; btn.disabled = false; btn.textContent = 'Sign In'; return }
    user = data.session.user
    try { await chrome.storage.local.set({ dc_access: data.session.access_token, dc_refresh: data.session.refresh_token }) } catch (e) { console.log('Storage set error:', e) }
    await loadProfile()
    btn.disabled = false; btn.textContent = 'Sign In'
    showForm(); readPage()
  } catch (e) {
    console.error('Login error:', e)
    err.textContent = e.message || 'Login failed'; err.style.display = 'block'
    btn.disabled = false; btn.textContent = 'Sign In'
  }
})

document.getElementById('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('loginBtn').click() })

function readPage() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]?.id) { document.getElementById('sourceText').textContent = 'No tab - fill manually'; return }
    chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_PAGE_DATA' }, resp => {
      if (chrome.runtime.lastError || !resp) {
        document.getElementById('sourceText').textContent = 'Could not read page'
        document.getElementById('sourceTag').style.display = 'none'
        return
      }
      const f = resp.fields || {}, src = resp.source
      document.getElementById('sourceText').textContent = src === 'salesforce' ? 'Salesforce ' + (resp.sourceDetail || '') : src === 'linkedin' ? 'LinkedIn ' + (resp.sourceDetail || '') : resp.sourceDetail || 'Website'
      const tag = document.getElementById('sourceTag')
      tag.textContent = src === 'salesforce' ? 'SFDC' : src === 'linkedin' ? 'LI' : 'WEB'
      tag.className = 'source-tag source-' + src
      document.getElementById('sourceIcon').textContent = src === 'salesforce' ? '\u2601' : src === 'linkedin' ? '\uD83D\uDCBC' : '\uD83C\uDF10'

      if (src === 'salesforce' && Object.keys(f).length > 0) {
        const summary = document.getElementById('sfdcSummary')
        const list = document.getElementById('sfdcFieldsList')
        let html = ''
        for (const [k, v] of Object.entries(f)) {
          if (k === 'relatedContacts' || !v) continue
          html += '<div class="sfdc-row"><span class="sfdc-label">' + esc(k) + '</span><span class="sfdc-value">' + esc(String(v)) + '</span></div>'
        }
        if (html) { list.innerHTML = html; summary.style.display = 'block' }
      }

      function fill(id, val, tagId) {
        if (val) { document.getElementById(id).value = val; if (tagId) document.getElementById(tagId).style.display = 'inline-block' }
      }
      fill('companyName', f.companyName, 'companyTag')
      fill('website', f.website, 'websiteTag')
      fill('dealValue', f.dealValue, 'valueTag')
      fill('closeDate', f.closeDate, 'closeTag')
      fill('contactName', f.contactName, 'contactTag')
      fill('contactTitle', f.contactTitle, null)
      fill('contactEmail', f.contactEmail, null)
      fill('notes', f.description || f.notes, null)
      if (f.stage) { const sel = document.getElementById('stage'); for (const opt of sel.options) { if (opt.value === f.stage) { sel.value = f.stage; break } } }
      if (f.stageOriginal) {
        const n = document.getElementById('notes')
        n.value = (n.value ? n.value + '\n' : '') + 'SFDC Stage: ' + f.stageOriginal
      }
    })
  })
}

document.getElementById('createBtn').addEventListener('click', async () => {
  const companyName = document.getElementById('companyName').value.trim()
  if (!companyName) { document.getElementById('errorMsg').textContent = 'Company name is required'; document.getElementById('errorMsg').style.display = 'block'; return }
  const btn = document.getElementById('createBtn')
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Creating...'
  document.getElementById('errorMsg').style.display = 'none'

  try {
    const { data: deal, error } = await sb.from('deals').insert({
      rep_id: user.id,
      company_name: companyName,
      website: document.getElementById('website').value.trim() || null,
      stage: document.getElementById('stage').value,
      forecast_category: document.getElementById('forecast').value,
      deal_value: Number(document.getElementById('dealValue').value) || null,
      cmrr: Number(document.getElementById('cmrr').value) || null,
      target_close_date: document.getElementById('closeDate').value || null,
      notes: document.getElementById('notes').value.trim() || null,
    }).select().single()

    if (error) throw error

    const contactName = document.getElementById('contactName').value.trim()
    if (contactName) {
      await sb.from('contacts').insert({
        deal_id: deal.id, name: contactName,
        title: document.getElementById('contactTitle').value.trim() || null,
        email: document.getElementById('contactEmail').value.trim() || null,
        role_in_deal: 'Primary Contact', influence_level: 'Unknown',
      })
    }

    const { data: { session } } = await sb.auth.getSession()
    if (session) {
      fetch(EDGE_URL + '/research-company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token, 'apikey': SUPABASE_ANON_KEY },
        body: JSON.stringify({ deal_id: deal.id }),
      }).catch(() => {})
    }

    document.getElementById('formFields').style.display = 'none'
    document.getElementById('successMsg').style.display = 'block'
    document.getElementById('successTitle').textContent = companyName + ' created!'
    document.getElementById('openDeal').href = WEB_APP_URL + '/deal/' + deal.id
    btn.disabled = false; btn.textContent = 'Create Deal'
  } catch (err) {
    document.getElementById('errorMsg').textContent = err.message || 'Failed to create deal'
    document.getElementById('errorMsg').style.display = 'block'
    btn.disabled = false; btn.textContent = 'Create Deal'
  }
})

init().catch(err => {
  console.error('Init error:', err)
  document.getElementById('statusBadge').textContent = 'Error'
  document.getElementById('statusBadge').className = 'badge badge-red'
})
