/**
 * Server-rendering regression test.
 *
 * THE BUG THIS EXISTS FOR
 * -----------------------
 * components/client-root-layout.tsx wraps every page in the root layout. It
 * held a mount gate:
 *
 *   const [mounted, setMounted] = useState(false);
 *   useEffect(() => setMounted(true), []);
 *   if (!mounted) return null;
 *
 * Effects never run on the server, so every route server-rendered to `null`.
 * Measured against `next start` on 2026-09-15: `/`, `/companies`, `/jobs`,
 * `/explore-jobs` and a job detail page each returned a <body> containing only
 * script tags -- zero headings, zero content, on all 113,416 job URLs.
 *
 * It was invisible in a browser, because the page assembled itself after
 * hydration. It was total to anything that does not run JavaScript, and it made
 * the JobPosting markup on every job page unreachable to Google for Jobs.
 *
 * This suite renders the tree the way a server would -- no DOM, no effects --
 * and asserts that real markup comes out. It is a unit test rather than a
 * fetch against a running build so that `npm test` catches a reintroduction
 * without needing a server.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

/**
 * tsx compiles JSX with the CLASSIC runtime, which expects `React` to be in
 * scope in every file that contains JSX. Next compiles with the AUTOMATIC
 * runtime, which does not, so several components here legitimately have no
 * `import React` -- correct under Next, undefined under this harness.
 *
 * Exposing React globally makes the classic output resolve. It affects only
 * this test process; nothing in the app relies on it.
 */
globalThis.React = React

let pass = 0, fail = 0
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, got !== undefined ? `-> ${JSON.stringify(got)}` : '') }
}

// tsx exposes a TypeScript module as named exports on newer Node releases, but
// as a CommonJS-shaped `default` object on Node 20. CI deliberately tests Node
// 20, so read both interop shapes. This is a test-loader detail, not an
// application export difference.
const layoutModule = await import('../components/client-root-layout.tsx')
const ClientRootLayout = layoutModule.ClientRootLayout ?? layoutModule.default?.ClientRootLayout

/* ------------------- the root layout must render children ----------------- */
{
  const html = renderToStaticMarkup(
    React.createElement(
      ClientRootLayout,
      null,
      React.createElement('main', null, React.createElement('h1', null, 'Platform Engineer at Acme')),
    ),
  )

  t('server render is not empty', html.length > 0, html.length)
  t('children reach the server HTML', html.includes('Platform Engineer at Acme'))
  t('the heading element is present', html.includes('<h1'))
  t('the main element is present', html.includes('<main'))

  // The precise shape of the old failure: a non-empty component that rendered
  // to nothing at all.
  t('the root layout does not render to null', html.trim() !== '')
}

/* ------------- a nested tree, the shape a real page actually is ----------- */
{
  const Page = () =>
    React.createElement(
      'div',
      { className: 'min-h-screen' },
      React.createElement('h1', null, 'Explore open roles'),
      React.createElement('p', null, '113,416 postings'),
      React.createElement('a', { href: '/jobs/ashby/acme/1' }, 'Senior Engineer'),
    )

  const html = renderToStaticMarkup(
    React.createElement(ClientRootLayout, null, React.createElement(Page)),
  )

  t('nested page content renders', html.includes('Explore open roles'))
  t('text nodes render', html.includes('113,416 postings'))
  t('internal links render, so a crawler can follow them',
    html.includes('href="/jobs/ashby/acme/1"'))
}

/* ------------------ structured data survives the server pass -------------- */
// The JobPosting block is written with dangerouslySetInnerHTML inside the page.
// It only reaches a crawler if the tree around it server-renders.
{
  const schema = { '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Platform Engineer' }
  const html = renderToStaticMarkup(
    React.createElement(
      ClientRootLayout,
      null,
      React.createElement('script', {
        type: 'application/ld+json',
        dangerouslySetInnerHTML: { __html: JSON.stringify(schema).replace(/</g, '\\u003c') },
      }),
      React.createElement('h1', null, 'Platform Engineer'),
    ),
  )

  t('the ld+json script tag is in the server HTML', html.includes('application/ld+json'))
  t('the JobPosting payload is in the server HTML', html.includes('JobPosting'))

  const start = html.indexOf('application/ld+json">') + 'application/ld+json">'.length
  const end = html.indexOf('</script>', start)
  const parsed = JSON.parse(html.slice(start, end).replace(/\\u003c/g, '<'))
  t('and it parses back to the schema that went in', parsed.title === 'Platform Engineer')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
