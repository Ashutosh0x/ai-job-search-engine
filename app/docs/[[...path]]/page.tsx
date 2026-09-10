import { redirect } from 'next/navigation';

export default function DocsPage({ params }: { params?: { path?: string[] } }) {
  const subPath = params?.path?.length ? `/${params.path.join('/')}` : '';

  // In development, redirect directly to the Mintlify dev server to avoid any HMR/runtime clashes
  if (process.env.NODE_ENV !== 'production') {
    redirect(`http://localhost:3001${subPath}`);
  }

  // In production, middleware rewrites /docs to /api/docs (reverse proxy)
  // This component won't be reached in production.
  return null;
}


