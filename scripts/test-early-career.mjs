/**
 * Early-career classification.
 *
 * The risk here is not missing roles -- it is false positives. This drives a
 * facet people filter on, and a student filtering for "internship" who is shown
 * "Internal Communications Manager" stops trusting the filter entirely.
 *
 * So most of these assertions are about what must NOT classify.
 */

import { classifyEarlyCareer, EARLY_CAREER_CATEGORIES, VOCAB_LANGUAGES } from '../lib/pipeline/early-career.ts'

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`); if (detail !== undefined) console.log('        ', JSON.stringify(detail)?.slice(0, 220)) }
}
const cat = (title, desc = '') => classifyEarlyCareer(title, desc)?.category ?? null

/* ------------------------- the obvious positives --------------------------- */
{
  t('apprentice', cat('Software Apprentice') === 'apprenticeship')
  t('degree apprenticeship', cat('Digital Degree Apprenticeship 2026') === 'apprenticeship')
  t('graduate scheme', cat('Graduate Scheme - Technology') === 'graduate')
  t('internship', cat('Summer Internship, Data Science') === 'internship')
  t('placement year', cat('Industrial Placement Year - Engineering') === 'placement')
  t('management trainee', cat('Management Trainee Programme') === 'trainee')
  t('entry level', cat('Entry-Level Software Engineer') === 'entry-level')
  t('junior', cat('Junior Backend Developer') === 'junior')
}

/* --------------------- the false positives that matter --------------------- */
{
  t('"Internal Communications Manager" is NOT an internship',
    cat('Internal Communications Manager') !== 'internship', classifyEarlyCareer('Internal Communications Manager'))
  t('"International Tax Associate" is NOT an internship',
    cat('International Tax Associate') !== 'internship', classifyEarlyCareer('International Tax Associate'))
  t('"Head of Internal Audit" is NOT an internship',
    cat('Head of Internal Audit') !== 'internship', classifyEarlyCareer('Head of Internal Audit'))

  // Running the programme is not being on it.
  t('"Apprenticeship Programme Manager" does not classify',
    classifyEarlyCareer('Apprenticeship Programme Manager') === null,
    classifyEarlyCareer('Apprenticeship Programme Manager'))
  t('"Early Careers Recruiter" does not classify',
    classifyEarlyCareer('Early Careers Recruiter') === null,
    classifyEarlyCareer('Early Careers Recruiter'))
  t('"Head of Graduate Recruitment" does not classify',
    classifyEarlyCareer('Head of Graduate Recruitment') === null,
    classifyEarlyCareer('Head of Graduate Recruitment'))
  t('"Campus Recruiting Coordinator" does not classify',
    classifyEarlyCareer('Campus Recruiting Coordinator') === null,
    classifyEarlyCareer('Campus Recruiting Coordinator'))
  t('"Intern Program Director" does not classify',
    classifyEarlyCareer('Intern Program Director') === null,
    classifyEarlyCareer('Intern Program Director'))

  // Seniority contradicts.
  t('"Senior Manager, Graduate Programmes" does not classify',
    classifyEarlyCareer('Senior Manager, Graduate Programmes') === null,
    classifyEarlyCareer('Senior Manager, Graduate Programmes'))
  t('"Staff Engineer" does not classify', classifyEarlyCareer('Staff Engineer') === null)
  t('"Principal Consultant" does not classify', classifyEarlyCareer('Principal Consultant') === null)

  // A senior posting that merely mentions mentoring juniors.
  t('a senior role mentioning interns in its description does not classify',
    classifyEarlyCareer('Senior Software Engineer',
      'You will mentor our interns and graduate engineers throughout the internship programme.') === null,
    classifyEarlyCareer('Senior Software Engineer', 'You will mentor our interns.'))
}

/* ----------------------------- multilingual -------------------------------- */
{
  t('German Ausbildung', cat('Ausbildung zum Fachinformatiker') === 'apprenticeship')
  t('German Praktikum', cat('Praktikum im Bereich Marketing') === 'internship')
  t('German Werkstudent', cat('Werkstudent Data Engineering') === 'internship')
  t('German duales Studium', cat('Duales Studium Wirtschaftsinformatik') === 'apprenticeship')
  t('French alternance', cat('Alternance - Developpeur Web') === 'apprenticeship')
  t('French stage', cat('Stage Ingenieur Logiciel') === 'internship')
  t('Spanish practicas', cat('Practicas en Ingenieria de Software') === 'internship')
  t('Italian tirocinio', cat('Tirocinio in Data Science') === 'internship')
  t('Dutch stagiair', cat('Stagiair Software Ontwikkeling') === 'internship')
  t('Portuguese estagio', cat('Estagio em Engenharia de Dados') === 'internship')
  t('Japanese intern', cat('ソフトウェアエンジニア インターン') === 'internship')
  t('Japanese new grad', cat('新卒 エンジニア') === 'graduate')

  t('covers a real spread of languages', VOCAB_LANGUAGES.length >= 8, VOCAB_LANGUAGES)
}

/* ------------------------ employer heading categories ---------------------- */
{
  // §13: these are how employers label the programmes, and none of them
  // contain "intern" or "apprentice".
  t('Emerging Talent', cat('Emerging Talent Analyst') === 'graduate')
  t('Future Talent', cat('Future Talent Programme - Finance') === 'graduate')
  t('School Leaver', cat('School Leaver Programme - Audit') === 'graduate')
  t('New Grad', cat('Software Engineer, New Grad 2026') === 'graduate')
}

/* ------------------------------- metadata ---------------------------------- */
{
  const m = classifyEarlyCareer('Level 4 Digital Apprenticeship')
  t('extracts the UK apprenticeship level', m?.level === 4, m)
  t('reports the term that fired', typeof m?.term === 'string' && m.term.length > 0, m)
  t('reports where it matched', m?.field === 'title', m)
  t('reports a language', typeof m?.lang === 'string', m)

  const multi = classifyEarlyCareer('Degree Apprenticeship in Cyber Security')
  t('a multi-word title match is high confidence', multi?.confidence === 'high', multi)

  const single = classifyEarlyCareer('Apprentice Electrician')
  t('a single-word title match is medium confidence', single?.confidence === 'medium', single)

  t('every category is reachable', EARLY_CAREER_CATEGORIES.length === 7, EARLY_CAREER_CATEGORIES)
}

/* -------------------------- ordinary roles stay out ------------------------ */
{
  for (const title of [
    'Software Engineer', 'Product Manager', 'Account Executive',
    'Registered Nurse', 'Solutions Architect', 'Data Scientist',
    'Chief Financial Officer', 'Warehouse Operative', 'Delivery Driver',
  ]) {
    t(`"${title}" does not classify`, classifyEarlyCareer(title) === null, classifyEarlyCareer(title))
  }
}

/* ------------------------------- degraded ---------------------------------- */
{
  t('empty title returns null', classifyEarlyCareer('') === null)
  t('whitespace title returns null', classifyEarlyCareer('   ') === null)
  t('null-ish input does not throw', classifyEarlyCareer(undefined, undefined) === null)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
