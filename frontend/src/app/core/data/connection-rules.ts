import { ConnectionRule } from '../models';

export type RuleParamKey = 'indegree' | 'outdegree' | 'p';

/** Parametro che ogni regola di connessione aggiunge a `params`, con il valore proposto. */
export const RULE_PARAMS: Record<ConnectionRule, { key: RuleParamKey; initial: number } | null> = {
  all_to_all: null,
  one_to_one: null,
  fixed_indegree: { key: 'indegree', initial: 1 },
  fixed_outdegree: { key: 'outdegree', initial: 1 },
  pairwise_bernoulli: { key: 'p', initial: 0.1 },
};

export const CONNECTION_RULES = Object.keys(RULE_PARAMS) as ConnectionRule[];
