import { assertPublicHttpUrl, UnsafeUrlError } from '../lib/safe-fetch.ts'
const mustBlock = [
  'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
  'http://metadata.google.internal/computeMetadata/v1/',
  'http://127.0.0.1:8787/api/jobs',
  'http://localhost:3000/',
  'http://10.0.0.5/internal',
  'http://192.168.1.1/admin',
  'http://172.16.0.1/',
  'http://[::1]:8787/',
  'http://[::ffff:169.254.169.254]/',
  'http://[::ffff:127.0.0.1]/',
  'http://[::ffff:a9fe:a9fe]/',
  'http://[64:ff9b::169.254.169.254]/',
  'http://[fe80::1]/',
  'http://[fd00::1]/',
  'http://[::]/',
  'file:///C:/Windows/win.ini',
  'gopher://evil/',
  'http://user:pass@example.com/',
  'http://0.0.0.0/',
  'http://100.64.0.1/',
]
const mustAllow = ['https://example.com/cv.pdf', 'http://[2606:4700:4700::1111]/x.pdf']
let pass = 0, fail = 0
for (const u of mustBlock) {
  try { await assertPublicHttpUrl(u); console.log(`  FAIL  allowed (should block): ${u}`); fail++ }
  catch (e) { if (e instanceof UnsafeUrlError) { console.log(`  PASS  blocked: ${u}`); pass++ } else { console.log(`  FAIL  wrong error ${u}: ${e.message}`); fail++ } }
}
for (const u of mustAllow) {
  try { await assertPublicHttpUrl(u); console.log(`  PASS  allowed: ${u}`); pass++ }
  catch (e) { console.log(`  FAIL  blocked (should allow): ${u} -> ${e.message}`); fail++ }
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
