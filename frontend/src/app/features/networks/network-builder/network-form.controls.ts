import { FormArray, FormBuilder, FormControl, FormGroup } from '@angular/forms';

import { NetworkFormValue, PopulationForm, ProjectionForm } from './network-form.mapping';

type Controls<T> = { [K in keyof T]: FormControl<T[K]> };

export type PopulationGroup = FormGroup<Controls<PopulationForm>>;
export type ProjectionGroup = FormGroup<Controls<ProjectionForm>>;
export type NetworkForm = FormGroup<{
  name: FormControl<string>;
  description: FormControl<string>;
  populations: FormArray<PopulationGroup>;
  projections: FormArray<ProjectionGroup>;
}>;

const fb = new FormBuilder().nonNullable;

export const populationGroup = (value: PopulationForm): PopulationGroup => fb.group(value);
export const projectionGroup = (value: ProjectionForm): ProjectionGroup => fb.group(value);

export function networkForm(): NetworkForm {
  return fb.group({
    name: '',
    description: '',
    populations: fb.array<PopulationGroup>([]),
    projections: fb.array<ProjectionGroup>([]),
  });
}

/** Sostituisce tutto il contenuto del form con una sola emissione di `valueChanges`. */
export function fillForm(form: NetworkForm, value: NetworkFormValue): void {
  const { populations, projections } = form.controls;
  populations.clear({ emitEvent: false });
  projections.clear({ emitEvent: false });
  for (const pop of value.populations) populations.push(populationGroup(pop), { emitEvent: false });
  for (const proj of value.projections) projections.push(projectionGroup(proj), { emitEvent: false });
  form.patchValue({ name: value.name, description: value.description });
}
