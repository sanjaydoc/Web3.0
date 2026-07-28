import type { Store } from '../store/index.js';

/** A skill definition in the catalogue — a capability agents/dApps can advertise. */
export interface Skill {
  id: string; // slug, e.g. "summarize" or "weather-lookup"
  name: string;
  description: string;
  createdBy: string; // the address of the account that registered it (or "open")
  createdAt: string;
}

const SETTING_KEY = 'skills';
const ID_RE = /^[a-z][a-z0-9-]{1,31}$/;

/**
 * skills — a catalogue of skill definitions node operators register, so a skill can exist (and be
 * discovered) before any agent offers it. Persisted in the Store. Providers (agents advertising a
 * skill) are still derived from the registry; this just names and describes the skill itself.
 */
export class SkillsService {
  private readonly byId = new Map<string, Skill>();

  constructor(
    private readonly store: Store,
    private readonly clock: () => string,
  ) {}

  async load(): Promise<void> {
    const saved = (await this.store.loadSetting<Skill[]>(SETTING_KEY)) ?? [];
    for (const s of saved) this.byId.set(s.id, s);
  }

  private async persist(): Promise<void> {
    await this.store.saveSetting(SETTING_KEY, [...this.byId.values()]);
  }

  list(): Skill[] {
    return [...this.byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** Register a new skill. Throws on a bad id, a duplicate, or a missing name. */
  async create(input: {
    id: string;
    name: string;
    description?: string;
    createdBy: string;
  }): Promise<Skill> {
    const id = input.id.trim().toLowerCase();
    const name = input.name.trim();
    if (!ID_RE.test(id)) {
      throw new Error(
        'id must be 2–32 chars: lowercase letters, digits, hyphens (start with a letter)',
      );
    }
    if (!name) throw new Error('name is required');
    if (this.byId.has(id)) throw new Error(`skill "${id}" already exists`);
    const skill: Skill = {
      id,
      name,
      description: (input.description ?? '').trim(),
      createdBy: input.createdBy,
      createdAt: this.clock(),
    };
    this.byId.set(id, skill);
    await this.persist();
    return skill;
  }
}
