# The Mintlify docs site

Separate from this `docs/` folder. The `.mdx` files at the repository root plus
`mint.json` are a [Mintlify](https://mintlify.com) site — the end-user product
documentation, as opposed to the engineering documentation you are reading.

## Running it

```bash
npm install -g mintlify
mintlify dev
```

In **production**, `middleware.ts` rewrites `/docs/*` to
`app/api/docs/[...path]`, which proxies the built site. In **development** that
rewrite is deliberately skipped — proxying to a second dev server collides with
Next's HMR — so run `mintlify dev` alongside `npm run dev` instead.

## Layout

```
mint.json              navigation, branding, SEO
introduction.mdx       overview
quickstart.mdx         getting started
installation.mdx       setup
authentication.mdx     auth overview

features/              ai-resume-analysis · job-matching · resume-builder
                       profile-management · job-tracking · analytics-dashboard
user-management/       profile-settings · preferences · security · localization
api/                   authentication · resume-analysis · job-matching
                       profile-management · upload-endpoints
guides/                resume-optimization · job-search-strategy
                       profile-completion · security-best-practices
pricing/               plans · features-comparison · billing
troubleshooting/       common-issues · error-codes · performance
```

## Adding a page

1. Create the `.mdx` file in the right directory.
2. Add frontmatter:

   ```mdx
   ---
   title: 'Page Title'
   description: 'Description, used for SEO'
   ---
   ```

3. Add it to the `navigation` array in `mint.json` — a page not listed there is
   not reachable.

## Components available

`<Card>`, `<CardGroup>`, `<Steps>`, `<Tabs>`, `<Callout>`, `<CodeGroup>`.

## Deploying

```bash
mintlify build
mintlify deploy
```

Connecting the repository in the Mintlify dashboard gives automatic deploys on
push to the default branch and preview deploys for pull requests.

## Keeping it honest

This site describes the product to users, so it drifts from the code more easily
than engineering docs do. Two things to watch:

- The root README previously described *only* this docs site, which made the
  repository look like a documentation project rather than a search engine. If
  you restructure, keep the root README about the software.
- Several pages predate the September 2026 audit and may describe behaviour that
  has since changed — particularly around resume analysis failure modes and the
  job search endpoint, both of which used to return fabricated data and now
  return errors. Check against [API.md](API.md) before trusting a page.
