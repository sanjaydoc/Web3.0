import type { ModuleName } from '../config.js';
import type { Web3Module } from '../context.js';
import { accountsModule } from './accounts.js';
import { connectorsModule } from './connectors.js';
import { consensusModule } from './consensus.js';
import { erc8004Module } from './erc8004.js';
import { guardrailsModule } from './guardrails.js';
import { hostedModule } from './hosted.js';
import { hostingModule } from './hosting.js';
import { messagingModule } from './messaging.js';
import { namingModule } from './naming.js';
import { observabilityModule } from './observability.js';
import { operatorModule } from './operator.js';
import { paymentsModule } from './payments.js';
import { registryModule } from './registry.js';
import { skillsModule } from './skills.js';
import { telegramModule } from './telegram.js';
import { txModule } from './tx.js';
import { x402Module } from './x402.js';

/** The built-in module catalogue. The kernel instantiates only the ones listed in config. */
export const MODULE_FACTORIES: Record<ModuleName, () => Web3Module> = {
  naming: namingModule,
  accounts: accountsModule,
  skills: skillsModule,
  connectors: connectorsModule,
  registry: registryModule,
  messaging: messagingModule,
  payments: paymentsModule,
  x402: x402Module,
  erc8004: erc8004Module,
  guardrails: guardrailsModule,
  observability: observabilityModule,
  consensus: consensusModule,
  tx: txModule,
  telegram: telegramModule,
  hosted: hostedModule,
  operator: operatorModule,
  hosting: hostingModule,
};
