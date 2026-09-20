import { collectPublicRecords } from '../lib/contacts/sources/public-records.ts'

const domains = process.argv.slice(2).length ? process.argv.slice(2)
  : ['stripe.com','cloudflare.com','gitlab.com','shopify.com','google.com','nvidia.com','discord.com','expel.com']

let hit = 0
for (const d of domains) {
  const recs = await collectPublicRecords(d)
  if (recs.length) hit++
  console.log(`${d.padEnd(18)} ${recs.length} record(s)`)
  for (const r of recs) console.log(`    ${r.kind.padEnd(13)} ${r.address}`)
}
console.log(`\n${hit}/${domains.length} domains yielded at least one public-record address`)
