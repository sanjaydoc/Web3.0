import type { ModuleName } from '../config.js';
import type { AcpModule } from '../context.js';
import { consensusModule } from './consensus.js';
import { guardrailsModule } from './guardrails.js';
import { hostedModule } from './hosted.js';
import { messagingModule } from './messaging.js';
import { namingModule } from './naming.js';
import { observabilityModule } from './observability.js';
import { operatorModule } from './operator.js';
import { paymentsModule } from './payments.js';
import { registryModule } from './registry.js';
import { telegramModule } from './telegram.js';

/** The built-in module catalogue. The kernel instantiates only the ones listed in config. */
export const MODULE_FACTORIES: Record<ModuleName, () => AcpModule> = {
  naming: namingModule,
  registry: registryModule,
  messaging: messagingModule,
  payments: paymentsModule,
  guardrails: guardrailsModule,
  observability: observabilityModule,
  consensus: consensusModule,
  telegram: telegramModule,
  hosted: hostedModule,
  operator: operatorModule,
};
