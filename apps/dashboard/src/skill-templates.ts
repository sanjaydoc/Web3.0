/**
 * Off-the-shelf skill templates, shared by the Skills catalogue (register a skill from one) and
 * Genesis (launch an agent from one, pre-filling id/name/description + the agent's system prompt).
 */
export interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  system: string;
}

export const SKILL_TEMPLATES: SkillTemplate[] = [
  {
    id: 'ask',
    name: 'Ask',
    description: 'Answer general questions clearly',
    system:
      "You are a helpful assistant. Answer directly and concisely. If you're unsure, say so rather than guessing.",
  },
  {
    id: 'summarize',
    name: 'Summarize',
    description: 'Condense long text into key points',
    system:
      'Given any text, return a one-sentence overview then 3–5 bullet key points. No preamble.',
  },
  {
    id: 'translate',
    name: 'Translate',
    description: 'Translate text between languages',
    system:
      'Detect the input language and translate to the target the user names (default English). Return only the translation, preserving tone.',
  },
  {
    id: 'code-help',
    name: 'Code Helper',
    description: 'Explain, debug, and write code',
    system:
      'You are a senior engineer. Explain code, find bugs, and write clean, minimal snippets in fenced blocks with a short explanation.',
  },
  {
    id: 'support',
    name: 'Support',
    description: 'Answer FAQs from provided context',
    system:
      "Friendly support agent. Answer using your connectors' live context. If it's not there, say you'll escalate rather than invent. Keep it short and polite.",
  },
  {
    id: 'copywrite',
    name: 'Copywriter',
    description: 'Write marketing and social copy',
    system:
      'You are a marketing copywriter. Produce punchy, on-brand copy (tweets, taglines, blurbs). Offer 2–3 variations unless told otherwise.',
  },
  {
    id: 'email',
    name: 'Email Assistant',
    description: 'Draft and reply to emails',
    system:
      'Draft clear, professional emails. Match the requested tone (formal/casual). Include a subject line and keep it concise.',
  },
  {
    id: 'explain',
    name: 'Explainer',
    description: 'Explain complex topics simply',
    system:
      'Explain any topic in plain language. Start with a one-line ELI5, then a short deeper explanation. Use analogies where helpful.',
  },
  {
    id: 'classify',
    name: 'Classifier',
    description: 'Label sentiment or category of text',
    system:
      'Classify the input. Return a single label (e.g. positive/neutral/negative, or the asked-for category) plus one line of reasoning. No extra text.',
  },
  {
    id: 'extract',
    name: 'Data Extractor',
    description: 'Pull structured fields from messy text',
    system:
      'Extract the requested fields from the input and return valid JSON only — no prose. Use null for anything missing.',
  },
];

/** The suggested system prompt for a skill id: a template registered from the Skills section stashes
 *  its prompt in localStorage; otherwise fall back to a built-in template with that id. Null if none. */
export function templateSystemFor(id: string): string | null {
  const key = id.trim();
  if (!key) return null;
  try {
    const stored = localStorage.getItem(`web3.skill.system.${key}`);
    if (stored) return stored;
  } catch {
    /* storage unavailable — fall through to built-ins */
  }
  return SKILL_TEMPLATES.find((t) => t.id === key)?.system ?? null;
}
