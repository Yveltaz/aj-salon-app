// Xero redirects the owner's browser here after they approve the connection.
// Verifies the signed state, exchanges the code for tokens, looks up the tenant,
// stores the connection, and redirects back into the app. No JWT (verify_jwt=false)
// — trust comes from the HMAC-signed `state`.
import { verifyState, serviceClient, callbackUrl, basicAuthHeader } from '../_shared/xero.ts'

function errorPage(message: string): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Xero connection</title>
<style>body{font-family:system-ui,sans-serif;background:#f7f2ec;color:#221e1a;display:flex;
min-height:100vh;align-items:center;justify-content:center;margin:0}
.box{background:#fff;padding:32px 40px;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.12);max-width:440px;text-align:center}
h1{font-size:1.2rem;margin:0 0 8px}p{color:#6b6258;line-height:1.5}</style></head>
<body><div class="box"><h1>Couldn't connect to Xero</h1><p>${message}</p>
<p>Please close this window and try connecting again from the Reports screen.</p></div></body></html>`
  return new Response(html, { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

function redirectApp(origin: string, query: string): Response {
  // Always return to the canonical production app URL when configured, so a
  // connection started from a dynamic Vercel preview deployment still lands on
  // production. The signed origin is only a fallback if COMPANY_URL is unset.
  const base = Deno.env.get('COMPANY_URL') || origin || ''
  const location = base ? `${base}/admin?${query}` : ''
  if (!location) return errorPage('The connection succeeded but the app URL is unknown.')
  return new Response(null, { status: 302, headers: { Location: location } })
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state') || ''
  const xeroError = url.searchParams.get('error')

  // Verify state first so we know where to send the user back to.
  const payload = await verifyState(state)
  if (!payload) return errorPage('This connection link is invalid or has expired (links are valid for 10 minutes).')
  const origin = typeof payload.origin === 'string' ? payload.origin : ''

  if (xeroError) {
    return redirectApp(origin, `xero=error&message=${encodeURIComponent(xeroError)}`)
  }
  if (!code) return redirectApp(origin, 'xero=error&message=No+authorization+code+returned')

  try {
    // 1. Exchange the authorization code for tokens.
    const tokenRes = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl(),
      }),
    })
    const tokens = await tokenRes.json()
    if (!tokenRes.ok) {
      return redirectApp(origin, `xero=error&message=${encodeURIComponent(tokens.error_description || tokens.error || 'Token exchange failed')}`)
    }

    // 2. Find the tenant (Xero organisation) that was just authorized.
    const connRes = await fetch('https://api.xero.com/connections', {
      headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
    })
    const connections = await connRes.json()
    if (!connRes.ok || !Array.isArray(connections) || connections.length === 0) {
      return redirectApp(origin, 'xero=error&message=No+Xero+organisation+found')
    }
    const tenant = connections[0]

    // 3. Store the singleton connection (id=1, replacing any previous one).
    const supabase = serviceClient()
    const { error: upErr } = await supabase.from('xero_connection').upsert({
      id: 1,
      tenant_id: tenant.tenantId,
      tenant_name: tenant.tenantName,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      connected_at: new Date().toISOString(),
      connected_by: payload.employeeId || null,
    })
    if (upErr) return redirectApp(origin, `xero=error&message=${encodeURIComponent('Could not save connection: ' + upErr.message)}`)

    return redirectApp(origin, `xero=connected&org=${encodeURIComponent(tenant.tenantName || '')}`)
  } catch (e) {
    return redirectApp(origin, `xero=error&message=${encodeURIComponent((e as Error).message)}`)
  }
})
