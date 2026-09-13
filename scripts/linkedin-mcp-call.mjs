/**
 * Minimal stdio JSON-RPC client for the connected `mcp-server-linkedin` server.
 *
 * The server is registered in Claude but its tools are not exposed to the
 * agent's tool index, so we talk to it the same way an MCP client would: spawn
 * it under uvx, do the initialize handshake, call ONE read-only tool, print the
 * result, exit.
 *
 *   node scripts/linkedin-mcp-call.mjs <tool> '<json-args>'
 *   node scripts/linkedin-mcp-call.mjs search_people '{"keywords":"recruiter Jane Street"}'
 *   node scripts/linkedin-mcp-call.mjs get_company_employees '{"company_name":"jane-street","keywords":"recruiter"}'
 *
 * Read-only tools only. This client refuses the write/destructive tools
 * (send_message, connect_with_person) so an accidental arg can never message or
 * connect to anyone.
 */
import { spawn } from 'child_process'

const READ_ONLY = new Set([
  'search_people', 'get_company_employees', 'get_person_profile',
  'get_company_profile', 'search_companies', 'get_sidebar_profiles',
])

// Two modes:
//   single:  node linkedin-mcp-call.mjs <tool> '<json-args>'
//   batch:   node linkedin-mcp-call.mjs --batch <file.json> [outFile]
//            file.json = [{ "label": "...", "tool": "...", "args": {...} }, ...]
// Batch keeps ONE warm browser and paces calls (LI_BATCH_DELAY_MS, default 12s)
// to respect LinkedIn rate limits.
import { readFileSync as _read, writeFileSync as _write } from 'fs'
const BATCH = process.argv[2] === '--batch'
const batchFile = BATCH ? process.argv[3] : null
const batchOut = BATCH ? (process.argv[4] || null) : null
const tool = BATCH ? null : process.argv[2]
const args = BATCH ? null : (process.argv[3] ? JSON.parse(process.argv[3]) : {})
const batchCalls = BATCH ? JSON.parse(_read(batchFile, 'utf8')) : null

if (BATCH) {
  for (const c of batchCalls) {
    if (!READ_ONLY.has(c.tool)) { console.error(`refusing batch: ${c.tool} not read-only`); process.exit(2) }
  }
} else if (!tool || !READ_ONLY.has(tool)) {
  console.error(`refusing: tool must be one of ${[...READ_ONLY].join(', ')}`)
  process.exit(2)
}

const serverArgs = ['--python', '3.13', 'mcp-server-linkedin@latest']
// Use the authenticated session profile if one was created by --login.
if (process.env.LI_USER_DATA_DIR) {
  serverArgs.push('--user-data-dir', process.env.LI_USER_DATA_DIR, '--claim-profile-root')
}
const child = spawn('uvx', serverArgs, {
  env: { ...process.env, UV_HTTP_TIMEOUT: '300', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  stdio: ['pipe', 'pipe', 'inherit'],
})

let buf = ''
const pending = new Map()
child.stdout.on('data', (d) => {
  buf += d.toString('utf8')
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
})

const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n')
const rpc = (id, method, params) =>
  new Promise((resolve) => { pending.set(id, resolve); send({ jsonrpc: '2.0', id, method, params }) })

const TIMEOUT = Number(process.env.LI_TIMEOUT_MS || 240000)
const killer = setTimeout(() => { console.error('timeout'); child.kill('SIGKILL'); process.exit(3) }, TIMEOUT)

try {
  await rpc(1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'recruiter-intel', version: '1.0' },
  })
  send({ jsonrpc: '2.0', method: 'notifications/initialized' })

  let id = 2
  // One tool call with retry over the "browser not ready" background setup.
  const callWithRetry = async (name, argz) => {
    const maxTries = Number(process.env.LI_RETRIES || 6)
    let res
    for (let attempt = 1; attempt <= maxTries; attempt++) {
      res = await rpc(id++, 'tools/call', { name, arguments: argz })
      const txt = (res.result?.content ?? []).map((c) => c.text).join(' ')
      if (!/not ready|setup .*not complete|downloading|starting|fresh background|wait and call/i.test(txt)) break
      const sleepMs = Number(process.env.LI_SLEEP_MS || 20000)
      process.stderr.write(`  [browser setup not ready, retry ${attempt}/${maxTries} in ${sleepMs / 1000}s]\n`)
      await new Promise((r) => setTimeout(r, sleepMs))
    }
    if (res.error) return { ok: false, error: res.error }
    return {
      ok: true,
      structured: res.result?.structuredContent ?? null,
      text: (res.result?.content ?? []).map((c) => c.text).filter(Boolean).join('\n'),
    }
  }

  if (BATCH) {
    const delay = Number(process.env.LI_BATCH_DELAY_MS || 12000)
    const out = []
    for (let i = 0; i < batchCalls.length; i++) {
      const c = batchCalls[i]
      process.stderr.write(`  [batch ${i + 1}/${batchCalls.length}] ${c.label || c.tool}\n`)
      const r = await callWithRetry(c.tool, c.args || {})
      out.push({ label: c.label ?? null, tool: c.tool, args: c.args ?? {}, ...r })
      if (i < batchCalls.length - 1) await new Promise((r) => setTimeout(r, delay))
    }
    clearTimeout(killer)
    const json = JSON.stringify(out, null, 2)
    if (batchOut) _write(batchOut, json)
    else console.log(json)
  } else {
    const r = await callWithRetry(tool, args)
    clearTimeout(killer)
    console.log(JSON.stringify(r, null, 2))
  }
  child.kill('SIGKILL')
  process.exit(0)
} catch (e) {
  clearTimeout(killer)
  console.error('client error:', e?.message || e)
  child.kill('SIGKILL')
  process.exit(1)
}
