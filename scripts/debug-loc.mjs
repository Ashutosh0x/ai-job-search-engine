import { parseLocation } from '../lib/location.ts'
for (const s of ['Remote, Bangalore','Bangalore, India','Bengaluru - Blr1','Bangalore, KA, India',
                 'Whitefield RD - Adm: Intl Tech Park, Bangalore, Gurugram','Bangalore, IN','Indianapolis, IN']) {
  const r = parseLocation(s)
  console.log(`  ${JSON.stringify(s).padEnd(56)} -> city=${r.city} | state=${r.region} | country=${r.country}`)
}
