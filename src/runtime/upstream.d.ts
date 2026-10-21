declare module '@deepseek-ai/dsh/profile-boot' {
  export function runProfile(options: {
    environment: Record<string, string | undefined>; profile: string;
    resolvedProfile: { profile: object; installAnchor: string }; patchFiles: string[]; args: string[];
    packageManager: { command: string; args: string[]; env: Record<string, string | undefined> };
  }): Promise<import('./contracts.js').RuntimeApp>;
}
declare module '@deepseek-ai/dsh-app-boot' {
  export function loadProfileDirectory(name: string, directory: string, anchor: string): object;
  export function loadLayeredEnv(name: string): Record<string, string | undefined>;
}
declare module '@deepseek-ai/cordis' {
  export const Context: new () => import('./contracts.js').MigrationContext;
}
