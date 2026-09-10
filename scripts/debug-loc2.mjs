import { parseLocation } from '../lib/location.ts'
for (const s of ['Whitefield RD - Adm: Intl Tech Park, Bangalore, Gurugram',
                 'Jalan Molek 3/20, Johor Bahru, Malaysia',
                 'No.16 Hongfeng Road, Nanjing, China',
                 '3500GS Utrecht, Netherlands',
                 'San Francisco, CA, USA',
                 'Bangalore, KA, India']) {
  const r = parseLocation(s)
  console.log(`  ${JSON.stringify(s).slice(0,52).padEnd(54)} city=${r.city} | state=${r.region} | country=${r.country}`)
}
