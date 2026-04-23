// create-invited-user — creates an auto-confirmed user for a valid invitation
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const body = await req.json().catch(() => ({}))
    const { token, password, full_name, initials } = body
    if (!token || !password || !full_name) {
      return jsonResp(400, { error: 'token, password, and full_name are required' })
    }

    // Look up the invitation
    const { data: inv, error: invErr } = await admin
      .from('invitations').select('*').eq('token', token).single()
    if (invErr || !inv) return jsonResp(404, { error: 'Invitation not found' })
    if (inv.status !== 'pending') return jsonResp(400, { error: `Invitation is ${inv.status}` })
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
      return jsonResp(400, { error: 'Invitation has expired' })
    }

    // Check if auth user already exists for this email
    const { data: existingUsers } = await admin.auth.admin.listUsers()
    const existing = existingUsers?.users?.find(
      (u: any) => u.email?.toLowerCase() === inv.email.toLowerCase()
    )

    let userId: string
    if (existing) {
      userId = existing.id
      // Auto-confirm if not confirmed
      if (!existing.email_confirmed_at) {
        await admin.auth.admin.updateUserById(userId, {
          email_confirm: true,
          password,
        })
      }
    } else {
      // Create user with auto-confirm
      const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
        email: inv.email,
        password,
        email_confirm: true,
      })
      if (createErr || !newUser?.user) {
        return jsonResp(500, { error: createErr?.message || 'Failed to create user' })
      }
      userId = newUser.user.id
    }

    // Upsert profile
    const userInitials = initials || full_name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
    await admin.from('profiles').upsert({
      id: userId,
      email: inv.email,
      full_name,
      initials: userInitials,
      org_id: inv.invitation_type === 'teammate' ? inv.org_id : null,
      role: inv.role || 'rep',
    }, { onConflict: 'id' })

    // Accept invitation
    await admin.rpc('accept_invitation', { p_token: token, p_user_id: userId })

    // Apply module access (best-effort)
    try {
      await admin.rpc('apply_invitation_module_access', { p_invitation_id: inv.id, p_user_id: userId })
    } catch (_) {}

    // Sign the user in to get a session
    const { data: signInData, error: signInErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: inv.email,
    })

    // Return success with user ID — frontend will sign in with password
    return jsonResp(200, {
      success: true,
      user_id: userId,
      email: inv.email,
      invitation_type: inv.invitation_type,
      invitation_id: inv.id,
    })
  } catch (err: any) {
    console.error('create-invited-user fatal:', err)
    return jsonResp(500, { error: err?.message || String(err) })
  }
})

function jsonResp(status: number, body: any) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
