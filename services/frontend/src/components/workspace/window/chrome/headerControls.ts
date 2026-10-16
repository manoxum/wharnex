import { createContext, useContext, type ReactNode } from 'react'

// Opt-in composition: complex workspaces place the same window controls in
// their own heading. Legacy windows retain the original overlay placement.
export const InternalWindowHeaderControls = createContext<ReactNode>(null)
export function useInternalWindowHeaderControls() { return useContext(InternalWindowHeaderControls) }
