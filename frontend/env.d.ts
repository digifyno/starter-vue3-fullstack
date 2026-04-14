/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

import 'vue-router';

declare module 'vue-router' {
  interface RouteMeta {
    /** Require authenticated session to access this route */
    auth?: boolean;
    /** Route is only for unauthenticated users (redirects logged-in users away) */
    guest?: boolean;
    /** Page title for document.title */
    title?: string;
  }
}
