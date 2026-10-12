/// <reference types="vite/client" />

declare module "@adobe/uix-guest" {
  interface UixConnection {
    host: any;
    sharedContext: any;
  }
  export function register(options: Record<string, unknown>): Promise<UixConnection>;
  export function attach(options: { id: string }): Promise<UixConnection>;
}
