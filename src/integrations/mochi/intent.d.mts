export function resolvePlanIntent(input: { prompt: string; block: { type: string } }): { permissions: Set<string>; presentation: Set<string>; addingField: boolean }
export function assertPlanIntent(candidate: unknown, input: { prompt: string; block: { type: string; fieldIds?: readonly string[] } }): unknown
