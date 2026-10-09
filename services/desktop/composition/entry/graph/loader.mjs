const stub = new URL('./electron-stub.mjs', import.meta.url).href

export async function resolve(specifier, context, next) {
  if (specifier === 'electron') return { url: stub, shortCircuit: true }
  return next(specifier, context)
}
