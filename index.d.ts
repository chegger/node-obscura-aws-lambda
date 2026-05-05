export interface StartObscuraOptions {
  port?: number;
  host?: string;
  stealth?: boolean;
  startupTimeoutMs?: number;
  extraArgs?: string[];
}

export interface StartedObscura {
  endpoint: string;
  wsEndpoint: string;
  close: () => Promise<void>;
}

export declare function getBinaryPath(): string;
export declare function startObscura(options?: StartObscuraOptions): Promise<StartedObscura>;
