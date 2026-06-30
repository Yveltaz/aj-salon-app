// Shared helpers for the Xero Edge Functions: CORS, owner-only auth, and a
// stateless signed-state token (HMAC) so the OAuth callback can trust the
// `state` param without a database round-trip.
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Service-role client — bypasses RLS. Only ever runs server-side in functions.
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
}

// Confirms the bearer token belongs to an authenticated owner. Returns the
// owner's employees row, or a Response to return early on failure.
export async function requireOwner(
  supabase: SupabaseClient,
  req: Request
): Promise<{ ok: true; userId: string; employeeId: string } | { ok: false; res: Response }> {
  const authHeader = req.headers.get('Authorization')
  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader?.replace('Bearer ', '')
  )
  if (authError || !user) return { ok: false, res: json({ error: 'Not authenticated' }, 401) }
  const { data: caller } = await supabase
    .from('employees').select('employee_id, role').eq('user_id', user.id).single()
  if (caller?.role !== 'owner') {
    return { ok: false, res: json({ error: 'Only the owner can manage the Xero connection' }, 403) }
  }
  return { ok: true, userId: user.id, employeeId: caller.employee_id }
}

// ---- signed state (HMAC-SHA256 over a JSON payload) -------------------------

const enc = new TextEncoder()
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64urlDecode = (s: string) => {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : ''
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}

async function hmacKey() {
  return crypto.subtle.importKey(
    'raw', enc.encode(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  )
}

export async function signState(payload: Record<string, unknown>): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)))
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(body)))
  return `${body}.${b64url(sig)}`
}

// Returns the payload if the signature is valid and not expired, else null.
export async function verifyState(state: string): Promise<Record<string, any> | null> {
  const [body, sig] = (state || '').split('.')
  if (!body || !sig) return null
  const valid = await crypto.subtle.verify('HMAC', await hmacKey(), b64urlDecode(sig), enc.encode(body))
  if (!valid) return null
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)))
    if (typeof payload.exp === 'number' && Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

export function callbackUrl(): string {
  return `${Deno.env.get('SUPABASE_URL')}/functions/v1/xero-oauth-callback`
}

export function basicAuthHeader(): string {
  const id = Deno.env.get('XERO_CLIENT_ID')!
  const secret = Deno.env.get('XERO_CLIENT_SECRET')!
  return 'Basic ' + btoa(`${id}:${secret}`)
}
