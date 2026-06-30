// Run once: node scripts/seed-auth.js
// Creates a Supabase Auth user for each staff PIN so PIN login can issue a JWT.
// Requires SUPABASE_SERVICE_ROLE_KEY in .env.local — this key is secret,
// never commit it, never expose it to the frontend.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

// Minimal .env.local loader (avoids adding a dotenv dependency for one script)
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
)

const url = env.VITE_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(url, serviceKey)

const pins = ['1111', '2222', '3333', '0000', '9999']

for (const pin of pins) {
  const email = `${pin}@aj-salon.internal`
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: pin,
    email_confirm: true,
  })
  if (error) {
    if (error.message.includes('already been registered')) {
      console.log(`PIN ${pin} — user already exists, skipping`)
    } else {
      console.error(`PIN ${pin} — failed:`, error.message)
    }
  } else {
    console.log(`PIN ${pin} — created user ${data.user.id}`)
  }
}

console.log('Done.')
