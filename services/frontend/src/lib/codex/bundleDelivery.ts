// Release the native transport only after backend validation, before any next turn.
export type ValidatedBundleSubmit = (base64: string, requestId: string, filename: string, onValidated?: () => Promise<unknown>) => Promise<string>

export async function validatePlannerBundle<T>(validate: () => Promise<T>, onValidated?: () => Promise<unknown>): Promise<T> {
  const result = await validate()
  await onValidated?.()
  return result
}
