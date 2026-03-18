/**
 * This configuration file turns off Server-Side Rendering (SSR) for the entire application.
 * Fledge is an offline-first, client-side application that relies on browser APIs
 * like IndexedDB, which are not available in a server environment. This prevents server crashes.
 */
export const ssr = false;