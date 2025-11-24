export type Result<T> = {
    status: true;
    data: T;
} | {
    status: false;
    message: string;
    error?: unknown;
};
declare class SimpleEmitter {
    private listeners;
    on(event: string, fn: (...args: unknown[]) => void): this;
    once(event: string, fn: (...args: unknown[]) => void): this;
    off(event: string, fn: (...args: unknown[]) => void): this;
    emit(event: string, ...args: unknown[]): void;
}
type RouterOSResponse = Record<string, string>;
export interface RouterOSClientOptions {
    host: string;
    port?: number;
    ssl?: boolean;
    timeout?: number;
}
export declare function createRouterOSClient(options: RouterOSClientOptions): {
    connect: () => Promise<Result<void>>;
    login: (user: string, password: string) => Promise<Result<void>>;
    runCommand: (cmd: string, params?: Record<string, string>) => Promise<Result<RouterOSResponse[]>>;
    close: () => Result<void>;
    on: (event: string, fn: (...args: unknown[]) => void) => SimpleEmitter;
    once: (event: string, fn: (...args: unknown[]) => void) => SimpleEmitter;
    off: (event: string, fn: (...args: unknown[]) => void) => SimpleEmitter;
    getSystemIdentity(): Promise<Result<RouterOSResponse[]>>;
};
export {};
