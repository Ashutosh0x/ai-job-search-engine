import { promises as dns } from 'dns';

/**
 * Public-record address sources.
 *
 * Every source here is a record the domain owner publishes about themselves,
 * in a documented standard, readable without authentication:
 *
 *   security.txt   RFC 9116 — /.well-known/security.txt `Contact:` lines
 *   DMARC          RFC 7489 — `rua=`/`ruf=` reporting mailboxes in _dmarc TXT
 *   SOA RNAME      RFC 1035 — the zone's administrative mailbox
 *   RDAP           RFC 9083 — registry contact data, the successor to WHOIS
 *
 * WHY THESE AND NOT AN API
 * ------------------------
 * Measured over the 273-company registry, GitHub org mining produced a usable
 * address pattern for ZERO of them: it needs a GitHub org whose website
 * verifiably matches the domain AND public commits carrying corporate
 * addresses, and almost no employer clears both bars. A discovery engine whose
 * only source fires for 0% of its inputs is not a discovery engine.
 *
 * These four fire for a large share of domains because publishing them is
 * either required (SOA) or standard practice (DMARC, security.txt, RDAP).
 *
 * WHAT THEY DO AND DO NOT GIVE YOU
 * --------------------------------
 * They yield ROLE mailboxes — security@, dmarc-reports@, hostmaster@ — not
 * people. That is useful for reaching a company and for confirming a domain
 * genuinely receives mail, and it is NOT useful for inferring how the company
 * forms a person's address. `inferPattern` is only ever fed addresses that
 * came with a human name attached, so a role mailbox can never be mistaken for
 * evidence of a naming pattern.
 */

export type PublicRecordKind = 'security-txt' | 'dmarc' | 'soa' | 'rdap';

export interface PublicRecordAddress {
  address: string;
  kind: PublicRecordKind;
  /** Where this came from, specific enough for a reader to check it. */
  evidence: string;
}

const UA = 'AIJobSearchBot/1.0';
const ADDRESS_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

function onDomain(address: string, domain: string): boolean {
  const host = address.split('@')[1]?.toLowerCase() ?? '';
  const base = domain.toLowerCase().replace(/^www\./, '');
  return host === base || host.endsWith(`.${base}`);
}

/**
 * RFC 9116 security.txt.
 *
 * The spec puts the file at /.well-known/security.txt; the legacy root
 * location is still common enough to be worth the second request.
 */
export async function fromSecurityTxt(domain: string): Promise<PublicRecordAddress[]> {
  const paths = ['/.well-known/security.txt', '/security.txt'];
  const found = new Map<string, PublicRecordAddress>();

  for (const path of paths) {
    for (const host of [`https://${domain}`, `https://www.${domain}`]) {
      try {
        const res = await fetch(`${host}${path}`, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) continue;

        // A security.txt is text/plain. An HTML body means a catch-all 200
        // page, not the record — parsing it would invent contacts from markup.
        const type = res.headers.get('content-type') ?? '';
        if (!type.includes('text/plain')) continue;

        const body = await res.text();
        for (const line of body.split(/\r?\n/)) {
          const match = line.match(/^\s*Contact:\s*(?:mailto:)?\s*(\S+)\s*$/i);
          if (!match) continue;

          const value = match[1].replace(/^mailto:/i, '').toLowerCase();
          if (!ADDRESS_RE.test(value)) continue; // Contact: may be a URL
          if (!onDomain(value, domain)) continue;

          found.set(value, {
            address: value,
            kind: 'security-txt',
            evidence: `Contact: line in ${host}${path} (RFC 9116)`,
          });
        }
        if (found.size > 0) return Array.from(found.values());
      } catch {
        continue;
      }
    }
  }

  return Array.from(found.values());
}

/**
 * DMARC reporting mailboxes (`rua=`, `ruf=`).
 *
 * These are real, monitored inboxes on the company's own domain often enough
 * to be worth collecting, and their presence is strong evidence the domain's
 * mail is actively administered.
 */
export async function fromDmarc(domain: string): Promise<PublicRecordAddress[]> {
  const found = new Map<string, PublicRecordAddress>();

  try {
    const records = await dns.resolveTxt(`_dmarc.${domain}`);
    for (const record of records) {
      const joined = record.join('');
      if (!/^v=DMARC1/i.test(joined)) continue;

      for (const tag of ['rua', 'ruf']) {
        const match = joined.match(new RegExp(`${tag}=([^;]+)`, 'i'));
        if (!match) continue;

        for (const uri of match[1].split(',')) {
          const value = uri.trim().replace(/^mailto:/i, '').split('!')[0].toLowerCase();
          if (!ADDRESS_RE.test(value)) continue;
          // Third-party DMARC processors are extremely common here and are
          // not the employer's mailbox.
          if (!onDomain(value, domain)) continue;

          found.set(value, {
            address: value,
            kind: 'dmarc',
            evidence: `${tag}= in the _dmarc.${domain} TXT record (RFC 7489)`,
          });
        }
      }
    }
  } catch {
    // No DMARC record published.
  }

  return Array.from(found.values());
}

/**
 * The zone administrator's mailbox, from the SOA RNAME field.
 *
 * RNAME encodes an address in DNS form: the FIRST unescaped dot is the `@`,
 * so `hostmaster.example.com` means `hostmaster@example.com`. A dot that is
 * part of the local part is escaped as `\.`, which is why this cannot be a
 * plain `replace('.', '@')`.
 */
export async function fromSoa(domain: string): Promise<PublicRecordAddress[]> {
  try {
    const soa = await dns.resolveSoa(domain);
    const rname = soa?.hostmaster;
    if (!rname) return [];

    let local = '';
    let rest = '';
    for (let i = 0; i < rname.length; i++) {
      if (rname[i] === '\\') { local += rname[i + 1] ?? ''; i++; continue; }
      if (rname[i] === '.') { rest = rname.slice(i + 1); break; }
      local += rname[i];
    }
    if (!local || !rest) return [];

    const address = `${local}@${rest}`.toLowerCase();
    if (!ADDRESS_RE.test(address) || !onDomain(address, domain)) return [];

    return [{
      address,
      kind: 'soa',
      evidence: `RNAME field of the ${domain} SOA record (RFC 1035)`,
    }];
  } catch {
    return [];
  }
}

/**
 * Registry contact data over RDAP, the structured successor to WHOIS.
 *
 * Most registries redact registrant contacts post-GDPR, so this usually yields
 * only an abuse address or nothing. It is cheap and occasionally the only
 * source that fires.
 */
export async function fromRdap(domain: string): Promise<PublicRecordAddress[]> {
  const found = new Map<string, PublicRecordAddress>();

  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: { 'User-Agent': UA, Accept: 'application/rdap+json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];

    const data = await res.json();
    for (const entity of data.entities ?? []) {
      // jCard: ["vcard", [["email", {}, "text", "abuse@example.com"], ...]]
      const vcard = entity.vcardArray?.[1];
      if (!Array.isArray(vcard)) continue;

      for (const field of vcard) {
        if (!Array.isArray(field) || field[0] !== 'email') continue;
        const value = String(field[3] ?? '').toLowerCase();
        if (!ADDRESS_RE.test(value) || !onDomain(value, domain)) continue;

        const roles = Array.isArray(entity.roles) ? entity.roles.join('/') : 'contact';
        found.set(value, {
          address: value,
          kind: 'rdap',
          evidence: `RDAP ${roles} entity for ${domain} (rdap.org)`,
        });
      }
    }
  } catch {
    // RDAP unavailable, redacted, or the TLD has no RDAP service.
  }

  return Array.from(found.values());
}

/** Every public record for a domain, de-duplicated, cheapest sources first. */
export async function collectPublicRecords(domain: string): Promise<PublicRecordAddress[]> {
  const settled = await Promise.allSettled([
    fromSoa(domain),
    fromDmarc(domain),
    fromSecurityTxt(domain),
    fromRdap(domain),
  ]);

  const byAddress = new Map<string, PublicRecordAddress>();
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    for (const record of result.value) {
      if (!byAddress.has(record.address)) byAddress.set(record.address, record);
    }
  }

  return Array.from(byAddress.values());
}
