/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Was `ignoreBuildErrors: true`, which suppressed 13 real errors in app
    // code — including a `{}`-typed fetch response in the password-reset page
    // whose `.success` and `.error` reads were never checked, and a pie chart
    // whose state was typed as the input row rather than the derived segment.
    //
    // The typecheck is now a gate rather than a suggestion. `npx tsc --noEmit`
    // is clean; the vendored countries-states-cities-database submodule is
    // excluded in tsconfig.json since its seed script is not ours to fix.
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
