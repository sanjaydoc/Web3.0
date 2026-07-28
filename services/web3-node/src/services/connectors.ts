import type { Store } from '../store/index.js';

/** A custom connector an operator registers — an outward integration for agents/dApps. */
export interface Connector {
  id: string; // slug
  name: string;
  category: string;
  endpoint: string; // URL / base URL the connector talks to (may be empty)
  description: string;
  createdBy: string;
  createdAt: string;
}

const SETTING_KEY = 'connectors';
const ID_RE = /^[a-z][a-z0-9-]{1,31}$/;

/**
 * connectors — a registry of custom connectors node operators add on top of the built-in catalogue.
 * Persisted in the Store. The built-in catalogue lives in the dashboard; this stores the custom ones
 * so they survive restarts and are visible to the whole node.
 */
export class ConnectorsService {
  private readonly byId = new Map<string, Connector>();

  constructor(
    private readonly store: Store,
    private readonly clock: () => string,
  ) {}

  async load(): Promise<void> {
    const saved = (await this.store.loadSetting<Connector[]>(SETTING_KEY)) ?? [];
    for (const c of saved) this.byId.set(c.id, c);
  }

  private async persist(): Promise<void> {
    await this.store.saveSetting(SETTING_KEY, [...this.byId.values()]);
  }

  list(): Connector[] {
    return [...this.byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Register a custom connector. Throws on a bad id, a duplicate, or a missing name. */
  async create(input: {
    id: string;
    name: string;
    category?: string;
    endpoint?: string;
    description?: string;
    createdBy: string;
  }): Promise<Connector> {
    const id = input.id.trim().toLowerCase();
    const name = input.name.trim();
    if (!ID_RE.test(id)) {
      throw new Error(
        'id must be 2–32 chars: lowercase letters, digits, hyphens (start with a letter)',
      );
    }
    if (!name) throw new Error('name is required');
    if (this.byId.has(id)) throw new Error(`connector "${id}" already exists`);
    const connector: Connector = {
      id,
      name,
      category: (input.category ?? 'Custom').trim() || 'Custom',
      endpoint: (input.endpoint ?? '').trim(),
      description: (input.description ?? '').trim(),
      createdBy: input.createdBy,
      createdAt: this.clock(),
    };
    this.byId.set(id, connector);
    await this.persist();
    return connector;
  }

  async remove(id: string): Promise<boolean> {
    const existed = this.byId.delete(id);
    if (existed) await this.persist();
    return existed;
  }
}
