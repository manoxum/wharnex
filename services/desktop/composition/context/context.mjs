// The Desktop composition context is the single registry every composition
// stage reads its dependencies from and provides its outputs into. Factories
// destructure only what they use, so wiring a dependency never means editing a
// parameter list in the entry point.
//
// Two rules keep that implicit wiring safe:
// - a stage may provide a name once; redefining it with another value throws,
//   so two domains can never silently shadow each other's contract;
// - a stage that needs something a later stage provides asks for it through
//   `late`, which resolves at call time and names the missing provider when
//   it is called too early.

export function createCompositionContext(seed = {}) {
  return provide({}, seed, 'seed')
}

export function provide(context, values, stage) {
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(values))) {
    const current = Object.getOwnPropertyDescriptor(context, key)
    if (current && current.value !== descriptor.value) {
      throw new Error(`Desktop composition: ${stage} redefines '${key}'`)
    }
    if (!current) Object.defineProperty(context, key, { ...descriptor, enumerable: true, configurable: false })
  }
  return values
}

// Runs one domain factory over the context plus stage-local overrides and
// provides what it returns. Overrides keep their accessors live, and an output
// that merely echoes one of the factory's inputs is not a new contract, so it
// is not provided again.
export function compose(context, stage, factory, overrides = {}) {
  const input = Object.defineProperties({ ...context }, Object.getOwnPropertyDescriptors(overrides))
  const output = factory(input)
  const created = {}
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(output ?? {}))) {
    const echoed = Object.getOwnPropertyDescriptor(input, key)
    if (!echoed || echoed.value !== descriptor.value) Object.defineProperty(created, key, { ...descriptor, enumerable: true })
  }
  provide(context, created, stage)
  return output
}

export function late(context, ...names) {
  const forwarders = {}
  for (const name of names) {
    forwarders[name] = (...args) => {
      const target = context[name]
      if (typeof target !== 'function') {
        throw new Error(`Desktop composition: '${name}' was called before a stage provided it`)
      }
      return target(...args)
    }
  }
  return forwarders
}
