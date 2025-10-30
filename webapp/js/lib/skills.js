// webapp/js/lib/skills.js
// Tokenize + (optionally) AI-categorize skills into ATS-friendly headlines.
// Falls back to local heuristic until LanguageModel is available.

const ORDER = [
    "Programming","Frontend","Backend","Data & ML","Cloud & DevOps",
    "Databases","Testing","Tools","Languages","Other",
  ];
  
  // ---------- Tokenizer (works without AI) ----------
  // lib/skills.js
export function tokenizeSkills(text) {
    if (!text) return [];
  
    // Split roughly on commas or newlines
    const raw = text
      .split(/[\n,;]+/)
      .map(s => s.trim())
      .filter(Boolean);
  
    const merged = [];
    for (let s of raw) {
      // Join known multi-word patterns automatically
      s = s
        .replace(/\b(Machine)\s+(Learning)\b/gi, 'Machine Learning')
        .replace(/\b(Deep)\s+(Learning)\b/gi, 'Deep Learning')
        .replace(/\b(Natural)\s+(Language)\s+(Processing)\b/gi, 'Natural Language Processing')
        .replace(/\b(Computer)\s+(Vision)\b/gi, 'Computer Vision')
        .replace(/\b(Reinforcement)\s+(Learning)\b/gi, 'Reinforcement Learning')
        .replace(/\b(Data)\s+(Science)\b/gi, 'Data Science')
        .replace(/\b(Artificial)\s+(Intelligence)\b/gi, 'Artificial Intelligence')
        .replace(/\b(Cloud)\s+(Computing)\b/gi, 'Cloud Computing');
      merged.push(s);
    }
  
    // Remove duplicates and normalize casing
    return [...new Set(merged.map(s => s.trim()))];
  }
  
  // ---------- Local heuristic (fallback) ----------
  const PRETTY = {
    // (minimal prettifier; AI will do the heavy lifting once available)
    "js":"JavaScript","ts":"TypeScript","node":"Node.js","node.js":"Node.js",
    "postgres":"PostgreSQL","postgresql":"PostgreSQL","gcp":"GCP"
  };
  const norm = s => String(s).trim().toLowerCase().replace(/\s+/g," ").replace(/^nodejs$/,"node.js");
  const pretty = s => PRETTY[norm(s)] || s.trim().replace(/\b\w/g,c=>c.toUpperCase());
  
  const CATS_LOCAL = {
    "Programming": ["c","c++","cpp","c#","java","python","javascript","js","typescript","ts","go","golang","rust","kotlin","swift","ruby","php","r","matlab","scala","perl","bash","shell","powershell","solidity"],
    "Frontend": ["html","css","sass","less","tailwind","bootstrap","react","next.js","nextjs","angular","vue","nuxt","svelte"],
    "Backend": ["node","node.js","express","fastify","nestjs","nest","django","flask","spring","spring boot",".net",".net core","asp.net","rails","laravel","fastapi"],
    "Data & ML": [
      "pandas","numpy","scikit-learn","sklearn","tensorflow","pytorch","keras","xgboost","lightgbm","spark","hadoop","airflow","dbt","sql",
      "machine learning","ml","deep learning","dl","nlp","natural language processing","computer vision",
      "llm","large language models","transformer","transformers","generative ai","genai","recommender","recommendation"
    ],
    "Cloud & DevOps": ["aws","azure","gcp","google cloud","docker","kubernetes","k8s","terraform","ansible","jenkins","github actions","gitlab ci","circleci","linux","nginx","apache","grafana","prometheus"],
    "Databases": ["postgres","postgresql","mysql","sqlite","mongodb","redis","elasticsearch","dynamodb","oracle","snowflake","redshift","bigquery","cassandra","neo4j"],
    "Testing": ["jest","mocha","chai","cypress","playwright","selenium","junit","pytest","vitest"],
    "Tools": ["git","figma","jira","confluence","notion","slack","excel","word","powerpoint"]
  };
  
  function detectLocalCategory(n) {
    for (const [cat, list] of Object.entries(CATS_LOCAL)) if (list.includes(n)) return cat;
    if (/\b(sql|nosql)\b/.test(n)) return "Databases";
    if (/\bci\/cd\b/.test(n)) return "Cloud & DevOps";
    return "Other";
  }
  
  export function groupSkillsLocal(rawSkills = []) {
    const buckets = Object.fromEntries(ORDER.map(c => [c, []]));
    const seen = new Set();
    for (const raw of rawSkills) {
      const n = norm(raw);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      buckets[detectLocalCategory(n)].push(pretty(raw));
    }
    const pruned = {};
    for (const cat of ORDER) if (buckets[cat].length) {
      pruned[cat] = [...new Set(buckets[cat])].sort((a,b)=>a.localeCompare(b));
    }
    return pruned;
  }
  
  // ---------- AI path (Prompt API) ----------
  export async function groupSkillsAI(rawSkills = []) {
    if (!("LanguageModel" in self)) throw new Error("Prompt API unsupported");
    const avail = await self.LanguageModel.availability?.().catch(()=> "unsupported");
    if (avail !== "available") throw new Error(`Prompt API not ready: ${avail}`);
  
    const session = await self.LanguageModel.create();
  
    const schema = {
      type: "object",
      description: "Map resume skill categories to arrays of skills. Categories must be from the enum.",
      additionalProperties: false,
      properties: Object.fromEntries(ORDER.map(cat => [cat, { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true }])),
    };
  
    const prompt = `
  You are an ATS resume skill categorizer.
  Group the user's skills into these EXACT categories: ${ORDER.join(", ")}.
  Rules:
  - Use only those categories; if unsure, put the item in "Other".
  - Normalize skill casing (e.g., "javascript" → "JavaScript", "node" → "Node.js", "postgres" → "PostgreSQL").
  - Deduplicate within each category.
  - Return ONLY JSON, no prose.
  
  User skills:
  ${JSON.stringify(rawSkills, null, 2)}
  `.trim();
  
    const raw = await session.prompt(prompt, { responseConstraint: schema });
    let obj;
    try { obj = JSON.parse(raw); } catch { throw new Error("AI did not return JSON"); }
  
    // Sanitize to allowed categories and sort
    const out = {};
    for (const cat of ORDER) {
      const arr = Array.isArray(obj[cat]) ? obj[cat].map(String).filter(Boolean) : [];
      if (arr.length) out[cat] = [...new Set(arr)].sort((a,b)=>a.localeCompare(b));
    }
    return out;
  }