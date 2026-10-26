// Narrow contracts for the pinned public runtime features used by Companion.
// These declarations let source checks run without installing the DSH tree.
export interface RuntimeApp {
  ctx: {
    inject(names: string[], ready: () => void): void;
    webServer: { port: number };
    loader: { entries(): Iterable<{ options: { name: string }; disabled: boolean; fiber?: { await(): Promise<void> } }> };
  };
  shutdown: { shutdown(code: number): Promise<void> };
}
export interface DiagnosticError extends Error { code?: string; errors?: DiagnosticError[]; cause?: DiagnosticError }
export interface MigrationReport {
  version: number; sourceFound: boolean; historyFiles: number; historySessions: number; attachmentFiles: number;
  skipped: { id: string; code: string }[];
}
export interface PersistedEvent { type: string; data: unknown }
export interface AttachmentReference { attachmentId: string; mediaType?: string }
export interface AttachmentStore { imageHostPath(ref: AttachmentReference): string; fileHostPath(ref: AttachmentReference): string }
export interface PersistenceErrors {
  SessionPersistenceCorruptionError: new (...args: never[]) => Error;
  SessionFormatUnsupportedError: new (...args: never[]) => Error;
  SessionPersistenceNotFoundError: new (...args: never[]) => Error;
}
export interface MigrationContext {
  plugin(plugin: unknown, options: object): { await(): Promise<void> };
  fiber: { dispose(): Promise<void> };
  attachments: AttachmentStore;
  sessionPersistence: {
    list(): Promise<{ header: { id: string }; revision: number }[]>;
    open(id: string, mode: 'read'): Promise<{ read(): Promise<{ events: PersistedEvent[] }>; close(): Promise<void> }>;
    locate(header: { id: string }): { path: string };
    stat(id: string): Promise<{ revision: number }>;
  };
}
export interface WorkBuddyCredential {
  accessToken: string; refreshToken: string; expiresAtMs: number; domain: string;
  nickname?: string; uid?: string;
}
export interface WorkBuddyStatus {
  state: 'signed-in' | 'signed-out'; expiresAtMs?: number; nickname?: string; domain?: string; region?: string;
  authSource?: 'desktop-read-only'; authUsable?: boolean; authReason?: string;
}
export interface WorkBuddyStore {
  ownAuthPath(): string;
  current(): Promise<WorkBuddyCredential | undefined>;
  resolve(): Promise<WorkBuddyCredential>;
  status(): Promise<WorkBuddyStatus>;
  save(credential: WorkBuddyCredential): Promise<unknown>;
  importDocument(text: string): Promise<unknown>;
  logout(): Promise<unknown>;
}
