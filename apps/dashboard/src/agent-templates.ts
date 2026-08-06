/**
 * Whole-agent templates — one click fills the Genesis form with a complete, ready-to-launch agent:
 * name, skill, a strong system prompt, provider, price, AND the office tools it should use. Unlike a
 * skill template (which only sets the skill + prompt), an agent template also attaches built-in tools
 * (send_email, create_event, …) and lists the credentials the owner must connect for it to be fully
 * functional. This is how the "Basic Office Agent" ships as a product, not a config exercise.
 */
export interface AgentTemplate {
  /** Template id (for the picker). */
  id: string;
  /** Display name of the template shown on the pill. */
  label: string;
  /** One line describing what the agent does. */
  tagline: string;
  /** The agent preset the form is filled from. */
  agent: {
    handle: string;
    name: string;
    description: string;
    skillId: string;
    skillName: string;
    skillDesc: string;
    system: string;
    provider: string;
    model: string;
    priceUsd: number;
    /** Built-in office tools to enable (drives tool-calling mode on the node). */
    tools: string[];
  };
  /** Credentials the owner should connect for full functionality (shown as a checklist after applying). */
  requires: { label: string; where: string; optional?: boolean }[];
}

const OFFICE_SYSTEM = `You are a professional office assistant working on behalf of your owner. You have tools — use them deliberately, one at a time, and never invent their results.

How to work:
- Read-only actions — checking email (read_email), viewing the calendar (list_events), web_search, fetch_url — need NO permission. Do them immediately when asked; never ask "shall I proceed?" first.
- Current facts, prices, people, companies → use web_search (and fetch_url to open a specific page).
- Questions about the owner's own business, policies, or documents → answer from your knowledge base and cite the [source]. If it isn't there, say so rather than guessing.
- Email: use read_email to check or triage the inbox right away. Only for send_email (actually sending) must you first confirm the recipient, subject and body with the owner — never send without a clear go-ahead.
- Scheduling: use list_events to read the calendar right away. Only for create_event (actually booking) must you first confirm the title, date and time with the owner.
- If a tool reports it isn't configured, tell the owner exactly how to connect it (Connectors → Office tools) instead of pretending.

Be concise, accurate and professional. Do the smallest number of tool calls needed, then give a clear answer.`;

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'basic-office',
    label: 'Basic Office Agent',
    tagline: 'Web search · your documents · email · calendar',
    agent: {
      handle: 'office',
      name: 'Office Assistant',
      description:
        'A personal office assistant — researches the web, answers from your documents, and manages your email and calendar.',
      skillId: 'office',
      skillName: 'Office Assistant',
      skillDesc: 'Research, answer from your docs, and handle email + calendar',
      system: OFFICE_SYSTEM,
      provider: 'tunnel',
      model: '',
      priceUsd: 0,
      tools: ['web_search', 'send_email', 'read_email', 'create_event', 'list_events'],
    },
    requires: [
      { label: 'Email (send & read)', where: 'Connectors → Office tools · Email' },
      { label: 'Calendar (create & list)', where: 'Connectors → Office tools · Calendar' },
      {
        label: 'Knowledge base (your docs, for FAQs)',
        where: 'the agent’s Knowledge tab after launch',
        optional: true,
      },
    ],
  },
];
