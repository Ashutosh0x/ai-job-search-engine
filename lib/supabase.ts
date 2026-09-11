import { createClient } from '@supabase/supabase-js'

// Client-side Supabase client (singleton)
let supabaseClient: ReturnType<typeof createClient> | null = null

/**
 * Browser Supabase client, or null when it is not configured.
 *
 * WHY THIS RETURNS NULL RATHER THAN THROWING
 * ------------------------------------------
 * It used to build the client with non-null assertions:
 *
 *     createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, ...)
 *
 * With the env var absent that is `createClient(undefined, undefined)`, which
 * throws "supabaseUrl is required". `components/navigation.tsx` calls this on
 * mount and renders on EVERY page, so a deployment without Supabase config
 * showed "Application error: a client-side exception has occurred" on the whole
 * site -- including job search, which does not use Supabase at all.
 *
 * The server pages returned 200 throughout, which is what made it confusing:
 * the failure was entirely post-hydration.
 *
 * Returning null makes the absence a value callers must handle, so an
 * unconfigured auth backend degrades to "signed out" instead of taking down
 * every page. Callers should treat null as "no session, and no way to get one".
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}

export function getSupabaseClient() {
  if (supabaseClient) return supabaseClient
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  supabaseClient = createClient(url, key)
  return supabaseClient
}

// Server-side Supabase client with service role
export function getSupabaseServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
/* -------------------------------------------------------------------------- */

/**
 * A stand-in client for when Supabase is not configured.
 *
 * WHY A STUB AND NOT `null`
 * -------------------------
 * Returning null is the honest type, but it pushes a null check onto ~130 call
 * sites across ten components. Missing one reintroduces exactly the crash this
 * exists to prevent -- and `ignoreBuildErrors: true` means the compiler will
 * not catch the omission.
 *
 * Every one of those call sites already handles Supabase's `{ data, error }`
 * contract, because that is how the library reports failure. So this stub
 * answers through the SAME channel: every operation resolves to
 * `{ data: null, error: { message: 'Supabase is not configured' } }`.
 *
 * That is not faking success. It reports a real, specific failure in the shape
 * the caller is already written to handle, and the UI shows its normal error
 * path instead of the whole page dying after hydration.
 *
 * The chainable shape matters: callers write
 * `supabase.from('x').select('*').eq('id', 1).single()`, so every intermediate
 * must be both chainable and awaitable.
 */
function notConfigured() {
  return {
    data: null,
    error: {
      message: 'Supabase is not configured',
      details: 'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are not set.',
      code: 'SUPABASE_NOT_CONFIGURED',
    },
  }
}

function makeStub(): any {
  const result = notConfigured()

  // Chainable and awaitable at every link: `.from().select().eq()` must keep
  // returning something you can call more methods on OR await.
  const chain: any = new Proxy(function () {} as any, {
    get(_t, prop) {
      if (prop === 'then') {
        // Awaiting any link in the chain resolves to the error result.
        return (resolve: (v: unknown) => void) => resolve(result)
      }
      if (prop === 'data') return null
      if (prop === 'error') return result.error
      return () => chain
    },
    apply() {
      return chain
    },
  })

  return new Proxy({} as any, {
    get(_t, prop) {
      if (prop === 'auth') {
        return new Proxy({} as any, {
          get(_a, m) {
            // The session getters are what run on mount; they must resolve to
            // "signed out" rather than throw, so the app renders logged-out.
            if (m === 'getSession') return async () => ({ data: { session: null }, error: result.error })
            if (m === 'getUser') return async () => ({ data: { user: null }, error: result.error })
            if (m === 'onAuthStateChange') {
              return () => ({ data: { subscription: { unsubscribe() {} } } })
            }
            return async () => result
          },
        })
      }
      if (prop === 'storage') {
        return new Proxy({} as any, {
          get: () => () => chain,
        })
      }
      return () => chain
    },
  })
}

let stub: any = null

/**
 * The browser client, or a stub that reports "not configured" on every call.
 *
 * Use this from components. It never returns null and never throws, so a
 * missing backend degrades to visible errors rather than a blank page.
 */
export function getSupabaseClientSafe(): any {
  const real = getSupabaseClient()
  if (real) return real
  if (!stub) stub = makeStub()
  return stub
}
