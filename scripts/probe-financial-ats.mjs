import { writeFileSync } from 'fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

async function main() {
  const targets = [
    { name: 'Two Sigma Careers', url: 'https://careers.twosigma.com' },
    { name: 'Citadel Careers', url: 'https://www.citadel.com/careers/open-roles/' },
    { name: 'Citadel Sec Careers', url: 'https://www.citadelsecurities.com/careers/open-roles/' },
    { name: 'DE Shaw Careers', url: 'https://www.deshaw.com/careers' },
    { name: 'Goldman Sachs Careers', url: 'https://www.goldmansachs.com/careers' },
    { name: 'JP Morgan Careers', url: 'https://careers.jpmorgan.com' },
    { name: 'Morgan Stanley Careers', url: 'https://www.morganstanley.com/careers' },
    { name: 'UBS Careers', url: 'https://www.ubs.com/global/en/careers.html' },
    { name: 'BlackRock Careers', url: 'https://careers.blackrock.com' },
  ];

  console.log('--- Probing Top Financial Careers Frontends ---');
  for (const t of targets) {
    try {
      const res = await fetch(t.url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(12000)
      });
      const html = await res.text();
      console.log(`\n${t.name} -> HTTP ${res.status} (Length: ${html.length})`);

      const signatures = {
        workday: /([a-zA-Z0-9_\-\.]+myworkdayjobs\.com[^\s"'<>]+)/gi,
        workdayScript: /workday/gi,
        greenhouse: /(boards(?:-api)?\.greenhouse\.io[^\s"'<>]+|gh_jid)/gi,
        lever: /(api\.lever\.co[^\s"'<>]+|jobs\.lever\.co[^\s"'<>]+)/gi,
        oracleCloud: /(oraclecloud\.com[^\s"'<>]+)/gi,
        taleo: /(taleo\.net[^\s"'<>]+)/gi,
        eightfold: /(eightfold\.ai[^\s"'<>]+)/gi,
        avature: /(avature\.net[^\s"'<>]+)/gi,
        phenom: /(phenompeople\.com|phenom\.com[^\s"'<>]+)/gi,
        brassring: /(brassring\.com[^\s"'<>]+)/gi,
        icims: /(icims\.com[^\s"'<>]+)/gi,
        smartrecruiters: /(smartrecruiters\.com[^\s"'<>]+)/gi,
        hirevue: /(hirevue\.com[^\s"'<>]+)/gi,
        hackerrank: /(hackerrank\.com[^\s"'<>]+)/gi,
        codility: /(codility\.com[^\s"'<>]+)/gi,
        suited: /(suited\.com|joinsuited\.com[^\s"'<>]+)/gi,
        pymetrics: /(pymetrics\.com[^\s"'<>]+)/gi,
        harver: /(harver\.com[^\s"'<>]+)/gi,
        yello: /(yello\.co[^\s"'<>]+)/gi,
      };

      const hits = [];
      for (const [key, regex] of Object.entries(signatures)) {
        const matches = [...html.matchAll(regex)].map(m => m[0]);
        if (matches.length > 0) {
          hits.push(`${key}: ${[...new Set(matches)].slice(0, 3).join(', ')}`);
        }
      }
      if (hits.length) {
        console.log('  Detected signatures:');
        hits.forEach(h => console.log('    • ' + h));
      } else {
        console.log('  No external ATS script detected directly in landing markup (likely rendered via CSR/SPA or behind auth/proxy)');
      }
    } catch (err) {
      console.log(`${t.name} -> Error: ${err.message}`);
    }
  }
}

main();
