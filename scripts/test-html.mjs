import { htmlToText } from '../lib/sources/types.ts'
let pass=0,fail=0
const t=(n,c,g)=>{if(c){pass++;console.log('  PASS  '+n)}else{fail++;console.log('  FAIL  '+n+'  got: '+JSON.stringify(g))}}

const plain = htmlToText('<p>Hello <strong>world</strong></p>')
t('plain html stripped', plain==='Hello world', plain)

// The real Greenhouse case: HTML escaped inside HTML.
const doubled = htmlToText('<div>Intro.&lt;br&gt;&lt;span class="x"&gt;Visa sponsorship is available.&lt;/span&gt;</div>')
t('double-encoded markup fully removed', !/[<>]/.test(doubled), doubled)
t('text preserved', doubled.includes('Visa sponsorship is available.'), doubled)

const ents = htmlToText('<p>R&amp;D &quot;team&quot; &#39;now&#39;</p>')
t('entities decoded', ents==='R&D "team" \'now\'', ents)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail===0?0:1)
