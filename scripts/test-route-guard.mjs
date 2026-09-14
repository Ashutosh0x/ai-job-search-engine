/**
 * Which routes the auth middleware gates.
 *
 * This exists because the guard used raw `startsWith`, so '/resume' also
 * matched '/resume-builder' -- and removing '/resume-builder' from the list
 * would NOT have unprotected it, because the shorter entry kept matching. That
 * class of bug is invisible in review and obvious in a table of cases.
 *
 * The list is mirrored from middleware.ts rather than imported: middleware.ts
 * imports next/server, which does not load outside the Next runtime.
 */

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/profile',
  '/settings',
  '/resume',
  '/preferences',
]

function isProtectedRoute(pathname) {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/'),
  )
}

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`); if (detail !== undefined) console.log('        ', JSON.stringify(detail)) }
}

/* ------------------------------ must be gated ----------------------------- */
for (const p of [
  '/dashboard', '/dashboard/', '/dashboard/settings',
  '/profile', '/profile/edit',
  '/settings', '/settings/billing',
  '/resume', '/resume/history', '/resume/123',
  '/preferences',
]) {
  t(`gated: ${p}`, isProtectedRoute(p) === true)
}

/* ---------------------------- must be public ------------------------------ */
for (const p of [
  // The point of the change: the builder keeps nothing and needs no account.
  '/resume-builder',
  '/resume-builder/',
  '/explore-jobs',
  '/jobs',
  '/jobs/some-role',
  '/',
  '/login',
  '/companies',
  '/docs',
  // Near-misses that a raw prefix match would wrongly gate.
  '/resumes',
  '/resume-tips',
  '/profiles',
  '/settings-help',
  '/dashboards',
]) {
  t(`public: ${p}`, isProtectedRoute(p) === false)
}

/* --------------------- the specific regression guarded -------------------- */
{
  // Demonstrate that the OLD implementation got this wrong, so the test is
  // pinning a real behaviour change rather than restating the new code.
  const oldImpl = (pathname) =>
    ['/dashboard', '/profile', '/settings', '/resume', '/resume-builder', '/preferences']
      .some((prefix) => pathname.startsWith(prefix))

  t('the old prefix match gated /resume-builder', oldImpl('/resume-builder') === true)
  t('the new segment match does not', isProtectedRoute('/resume-builder') === false)
  t('and /resume itself is still gated', isProtectedRoute('/resume') === true)
  t('the old match also caught /resumes', oldImpl('/resumes') === true)
  t('the new one does not', isProtectedRoute('/resumes') === false)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
