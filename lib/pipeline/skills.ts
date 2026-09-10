/**
 * Skill and technology extraction (§21).
 *
 * Rule-based and alias-normalised rather than model-driven, because this runs
 * over every posting at ingest and must be deterministic and free. The alias
 * table is the substance: "K8s", "k8s", "Kubernetes" and "kube" all have to
 * collapse to one facet value or the filter fragments into near-duplicates.
 *
 * Matching is word-boundary aware. Naive substring matching is what makes
 * "R" match every posting containing the letter and "Go" match "Google", and
 * those false positives are worse than a missed skill.
 */

/** canonical -> the surface forms that map to it. */
const SKILL_ALIASES: Record<string, string[]> = {
  // languages
  javascript: ['javascript', 'js', 'es6', 'ecmascript'],
  typescript: ['typescript', 'ts'],
  python: ['python', 'py', 'python3'],
  java: ['java'],
  kotlin: ['kotlin'],
  swift: ['swift'],
  'c++': ['c++', 'cpp', 'cplusplus'],
  'c#': ['c#', 'csharp', 'dotnet', '.net'],
  c: ['c'],
  go: ['go', 'golang'],
  rust: ['rust'],
  ruby: ['ruby'],
  php: ['php'],
  scala: ['scala'],
  elixir: ['elixir'],
  r: ['r'],
  sql: ['sql'],
  bash: ['bash', 'shell scripting'],
  cuda: ['cuda'],
  verilog: ['verilog', 'systemverilog'],

  // frontend
  react: ['react', 'reactjs', 'react.js'],
  'react native': ['react native'],
  vue: ['vue', 'vuejs', 'vue.js'],
  angular: ['angular', 'angularjs'],
  svelte: ['svelte', 'sveltekit'],
  nextjs: ['next.js', 'nextjs'],
  tailwind: ['tailwind', 'tailwindcss'],
  graphql: ['graphql'],

  // backend / infra
  node: ['node', 'node.js', 'nodejs'],
  django: ['django'],
  rails: ['rails', 'ruby on rails'],
  spring: ['spring', 'spring boot'],
  fastapi: ['fastapi'],
  grpc: ['grpc'],
  kafka: ['kafka'],
  rabbitmq: ['rabbitmq'],

  // cloud
  aws: ['aws', 'amazon web services'],
  'google cloud': ['gcp', 'google cloud', 'google cloud platform'],
  azure: ['azure', 'microsoft azure'],
  kubernetes: ['kubernetes', 'k8s', 'kube'],
  docker: ['docker', 'containerd'],
  terraform: ['terraform'],
  ansible: ['ansible'],
  helm: ['helm'],
  serverless: ['serverless', 'lambda'],

  // data
  postgresql: ['postgresql', 'postgres', 'psql'],
  mysql: ['mysql', 'mariadb'],
  mongodb: ['mongodb', 'mongo'],
  redis: ['redis'],
  elasticsearch: ['elasticsearch', 'opensearch'],
  snowflake: ['snowflake'],
  databricks: ['databricks'],
  spark: ['spark', 'apache spark', 'pyspark'],
  airflow: ['airflow'],
  dbt: ['dbt'],
  clickhouse: ['clickhouse'],
  bigquery: ['bigquery'],

  // ai / ml
  pytorch: ['pytorch', 'torch'],
  tensorflow: ['tensorflow', 'tf'],
  jax: ['jax'],
  'hugging face': ['hugging face', 'huggingface', 'transformers'],
  llm: ['llm', 'large language model', 'large language models'],
  rag: ['rag', 'retrieval augmented generation'],
  'machine learning': ['machine learning', 'ml'],
  'deep learning': ['deep learning'],
  nlp: ['nlp', 'natural language processing'],
  'computer vision': ['computer vision', 'cv'],
  triton: ['triton', 'tensorrt', 'tensorrt-llm'],
  vllm: ['vllm'],
  'model serving': ['model serving', 'inference serving', 'model inference'],
  mlops: ['mlops'],
  langchain: ['langchain'],
  'vector database': ['vector database', 'pgvector', 'pinecone', 'weaviate', 'milvus'],

  // hardware / systems
  gpu: ['gpu', 'gpus'],
  fpga: ['fpga'],
  embedded: ['embedded systems', 'embedded'],
  linux: ['linux'],
  distributed: ['distributed systems'],

  // security
  'penetration testing': ['penetration testing', 'pentest', 'pentesting'],
  cryptography: ['cryptography', 'crypto'],
  'threat modeling': ['threat modeling', 'threat modelling'],
  siem: ['siem'],
  soc2: ['soc2', 'soc 2'],

  // practice
  ci: ['ci/cd', 'cicd', 'continuous integration'],
  agile: ['agile', 'scrum'],
  microservices: ['microservices'],
  rest: ['rest api', 'restful'],
}

/** Which canonical skills count as "technologies" rather than practices. */
const NON_TECHNOLOGY = new Set(['agile', 'ci', 'threat modeling', 'penetration testing', 'soc2'])

/**
 * Very short or highly ambiguous tokens are only accepted when they appear in a
 * clearly technical context, because "R", "C" and "Go" are otherwise
 * indistinguishable from ordinary prose.
 */
const AMBIGUOUS = new Set(['r', 'c', 'go', 'ts', 'js', 'py', 'tf', 'cv', 'ml'])

/**
 * Words that, in the immediate neighbourhood of an ambiguous token, mark it as
 * a technology rather than ordinary prose.
 *
 * A document-level check is far too weak: essentially every job description
 * contains "experience", so it admits everything. An earlier version of this
 * file used exactly that and tagged 1,838 of 15,725 postings with "c" and
 * 1,658 with "go" -- from phrases like "go above and beyond" and "plan C".
 */
const LOCAL_TECH_CONTEXT =
  /\b(c\+\+|c#|python|java|rust|golang|scala|kotlin|swift|ruby|perl|haskell|typescript|javascript|programming|languages?|proficiency|fluent|codebase)\b/i

interface Compiled {
  canonical: string
  re: RegExp
  ambiguous: boolean
  /** Raw pattern source, so the ambiguity check can re-scan globally. */
  source: string
}

const COMPILED: Compiled[] = Object.entries(SKILL_ALIASES).flatMap(([canonical, forms]) =>
  forms.map((form) => {
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // \b does not fire next to +, # or . so those need explicit edges.
    const needsCustomEdge = /[+#.]/.test(form)
    const pattern = needsCustomEdge
      ? `(^|[^a-z0-9])${escaped}($|[^a-z0-9+#.])`
      : `\\b${escaped}\\b`
    return {
      canonical,
      re: new RegExp(pattern, 'i'),
      ambiguous: AMBIGUOUS.has(form.toLowerCase()),
      source: pattern,
    }
  })
)

export interface ExtractedSkills {
  skills: string[]
  technologies: string[]
}

/**
 * For an ambiguous surface form, require technology-list context within a small
 * window around the match rather than anywhere in the document.
 */
function ambiguousTokenIsReal(sample: string, source: string): boolean {
  const global = new RegExp(source, 'gi')
  let m: RegExpExecArray | null
  let guard = 0
  while ((m = global.exec(sample)) !== null && guard++ < 200) {
    const from = Math.max(0, m.index - 70)
    const window = sample.slice(from, m.index + m[0].length + 70)
    if (LOCAL_TECH_CONTEXT.test(window)) return true
    if (global.lastIndex <= m.index) global.lastIndex = m.index + 1
  }
  return false
}

export function extractSkills(text: string, limit = 30): ExtractedSkills {
  if (!text) return { skills: [], technologies: [] }
  const sample = text.slice(0, 12_000)

  const found = new Set<string>()
  for (const { canonical, re, ambiguous, source } of COMPILED) {
    if (found.has(canonical)) continue
    if (!re.test(sample)) continue
    // An ambiguous form needs local evidence, not merely a hit somewhere.
    if (ambiguous && !ambiguousTokenIsReal(sample, source)) continue
    found.add(canonical)
  }

  const skills = [...found].slice(0, limit)
  return {
    skills,
    technologies: skills.filter((s) => !NON_TECHNOLOGY.has(s)),
  }
}

/** Canonicalise a single user-supplied skill for query matching. */
export function canonicalSkill(input: string): string {
  const t = input.trim().toLowerCase()
  for (const [canonical, forms] of Object.entries(SKILL_ALIASES)) {
    if (canonical === t || forms.includes(t)) return canonical
  }
  return t
}

export const KNOWN_SKILLS = Object.keys(SKILL_ALIASES)

/* -------------------------------- seniority ------------------------------- */

const SENIORITY_RULES: [RegExp, string][] = [
  [/\b(intern|internship|co-?op)\b/i, 'internship'],
  [/\b(new ?grad|graduate|entry[- ]level|junior|jr\.?)\b/i, 'entry'],
  [/\b(principal|distinguished|fellow)\b/i, 'principal'],
  [/\b(staff)\b/i, 'staff'],
  [/\b(director|head of|vp|vice president|chief|cto|ceo|cfo)\b/i, 'executive'],
  [/\b(manager|management)\b/i, 'manager'],
  [/\b(senior|sr\.?|lead)\b/i, 'senior'],
  [/\b(mid[- ]level|intermediate)\b/i, 'mid'],
]

export function inferSeniority(title: string, description = ''): string | null {
  // The title is authoritative; the description only fills a gap, since a
  // junior posting routinely mentions working "with senior engineers".
  for (const [re, level] of SENIORITY_RULES) if (re.test(title)) return level

  const yearsMatch = description.match(/(\d+)\+?\s*years?\b/i)
  if (yearsMatch) {
    const y = Number(yearsMatch[1])
    if (y >= 8) return 'staff'
    if (y >= 5) return 'senior'
    if (y >= 2) return 'mid'
    return 'entry'
  }
  return null
}

/** Title with seniority and noise removed, for grouping and matching. */
export function normalizedTitleOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/\b(senior|sr|junior|jr|staff|principal|lead|i{1,3}|iv)\b/g, ' ')
    .replace(/[^a-z0-9+#. ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
