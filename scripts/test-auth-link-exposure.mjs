// Regression tripwire: no API route may hand a generated Supabase auth link
// (magic link / recovery / invite) back to the HTTP caller.
//
// /api/generate-magic-link used to call auth.admin.generateLink({ type:
// 'recovery' }) and return `{ link: action_link }`, which the login form showed
// as a clickable link. Anyone who passed the CAPTCHA could request a working
// sign-in link for any email: account takeover. The fix emails the link with
// resetPasswordForEmail. This suite fails if any route under app/api calls
// generateLink or puts an action_link into a response again.
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

let passed = 0
let failed = 0
const check = (name, condition, actual = '') => {
  if (condition) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}${actual ? `: ${JSON.stringify(actual)}` : ''}`)
  }
}

function routes(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...routes(p))
    else if (/^route\.(ts|js)$/.test(name)) out.push(p)
  }
  return out
}

// Comments may describe the old bug; only code counts.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const files = routes('app/api')
check(`found API routes (${files.length})`, files.length > 10, files.length)

const offenders = []
for (const f of files) {
  const code = stripComments(readFileSync(f, 'utf8'))
  if (/admin\s*\.\s*generateLink\s*\(/.test(code)) offenders.push(`${f}: calls admin.generateLink`)
  if (/action_link/.test(code)) offenders.push(`${f}: references action_link`)
}
check('no route calls admin.generateLink or exposes action_link', offenders.length === 0, offenders)

const magic = stripComments(readFileSync('app/api/generate-magic-link/route.ts', 'utf8'))
check('generate-magic-link emails the link (resetPasswordForEmail)', /resetPasswordForEmail\s*\(/.test(magic))
check('generate-magic-link response carries no `link` field', !/\blink\s*:/.test(magic))

const form = stripComments(readFileSync('components/auth-form.tsx', 'utf8'))
check('auth form no longer renders a returned link as an anchor', !/href=\{magicLink\}/.test(form))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
