import type { AcpModule, ModuleContext } from '../context.js';

/**
 * guardrails — exposes the active policy set and thresholds. The enforcement lives in the
 * shared Guardrails engine (called by messaging and payments); this module makes the policy
 * configuration observable to the dashboard.
 */
export function guardrailsModule(): AcpModule {
  return {
    name: 'guardrails',
    version: '0.1.0',
    register({ http, guardrails, config }: ModuleContext) {
      http.get('/guardrails', () => ({
        policies: guardrails.policies,
        config: config.guardrails,
      }));
    },
  };
}
