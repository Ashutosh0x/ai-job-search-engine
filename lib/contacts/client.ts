import { ContactView, fromEnriched, fromRevealRow } from './normalize';
import { ContactDiscoveryRequest } from './types';

export type ExportFormat = 'csv' | 'json' | 'vcard';

/** Pull the server's own error message out of a failed response. */
export async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body.error ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

/**
 * Discover a contact without saving it. Anonymous callers are allowed here, so
 * the result has no id and cannot be listed or exported until it is revealed.
 */
export async function discoverContact(request: ContactDiscoveryRequest): Promise<ContactView> {
  const res = await fetch('/api/contacts/discover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(await readError(res));
  const body = await res.json();
  return fromEnriched(body.data.contact);
}

/** Discover and persist a contact against the signed-in user. */
export async function revealContact(request: ContactDiscoveryRequest): Promise<ContactView> {
  const res = await fetch('/api/contacts/reveal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(await readError(res));
  const body = await res.json();
  return fromRevealRow(body.data);
}

export interface RevealStats {
  totalReveals: number;
  verifiedReveals: number;
  listCount: number;
}

export async function fetchReveals(): Promise<{ contacts: ContactView[]; stats: RevealStats }> {
  const res = await fetch('/api/contacts/reveal');
  if (!res.ok) throw new Error(await readError(res));
  const body = await res.json();
  return {
    contacts: (body.data ?? []).map(fromRevealRow),
    stats: body.stats ?? { totalReveals: 0, verifiedReveals: 0, listCount: 0 },
  };
}

/**
 * Ask the server for an export and hand the bytes to the browser.
 *
 * The export route answers with a file body, not JSON, so the download is built
 * from the response blob rather than from anything reconstructed on the client.
 */
export async function downloadExport(contactIds: string[], format: ExportFormat): Promise<void> {
  if (contactIds.length === 0) throw new Error('Select at least one contact to export');

  const res = await fetch('/api/contacts/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contactIds, format }),
  });
  if (!res.ok) throw new Error(await readError(res));

  const blob = await res.blob();
  const extension = format === 'vcard' ? 'vcf' : format;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `contacts.${extension}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
