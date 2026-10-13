interface PopulationLike {
  id: string;
  size: number | string;
}

interface ProjectionLike {
  source: string;
  target: string;
  rule: string;
  params?: Record<string, unknown> | null;
}

export function countNeurons(populations: PopulationLike[] | null | undefined): number {
  return (populations ?? []).reduce((total, pop) => total + (Number(pop.size) || 0), 0);
}

/**
 * Sinapsi stimate dalle regole di connessione. indegree/outdegree si leggono
 * da `params`, dove li salva il backend e dove li legge il worker.
 */
export function countSynapses(
  populations: PopulationLike[] | null | undefined,
  projections: ProjectionLike[] | null | undefined,
): number {
  const size = new Map((populations ?? []).map((pop) => [pop.id, Number(pop.size) || 0]));
  return (projections ?? []).reduce((total, proj) => {
    const source = size.get(proj.source) ?? 0;
    const target = size.get(proj.target) ?? 0;
    switch (proj.rule) {
      case 'one_to_one':
        return total + Math.min(source, target);
      case 'fixed_indegree':
        return total + (Number(proj.params?.['indegree']) || 0) * target;
      case 'fixed_outdegree':
        return total + (Number(proj.params?.['outdegree']) || 0) * source;
      case 'pairwise_bernoulli':
        return total + Math.round((Number(proj.params?.['p']) || 0) * source * target);
      default:
        return total + source * target;
    }
  }, 0);
}
