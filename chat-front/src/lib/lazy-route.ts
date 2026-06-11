import type { ComponentType } from "react";

/**
 * Adapts a dynamic `import()` of a page module into the shape react-router's
 * `lazy` expects (`{ Component }`), so route definitions stay one line each
 * instead of repeating the `async () => { const { default } = await import() }`
 * block at every route.
 *
 * Usage:  { path: "settings", lazy: lazyRoute(() => import("@/routes/account")) }
 *
 * The imported module must `export default` the route component.
 */
export function lazyRoute(load: () => Promise<{ default: ComponentType }>) {
  return async () => ({ Component: (await load()).default });
}
