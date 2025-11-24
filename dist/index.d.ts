/**
 * A discriminated union type representing the result of an operation.
 *
 * This pattern allows for explicit error handling without throwing exceptions.
 * All async operations return a Result object, allowing callers to decide how to handle success and failure.
 *
 * @template T - The type of data returned on success
 *
 * @example
 * ```ts
 * const result = await client.runCommand("/system/identity/print");
 * if (!result.status) {
 *   console.log('something wrong happened ->', result.message);
 *   console.log('error ->', result.error); // actual error object
 * } else {
 *   console.log('everything went well ->', result.data);
 * }
 * ```
 */
export type Result<T> = {
    status: true;
    data: T;
} | {
    status: false;
    message: string;
    error?: unknown;
};
/**
 * Creates a simple event emitter with functional API.
 *
 * @returns An emitter object with methods to manage event listeners
 *
 * @example
 * ```ts
 * const emitter = createEmitter();
 *
 * emitter.on("data", (value) => console.log(value));
 * emitter.emit("data", 42); // logs: 42
 * ```
 */
export declare function createEmitter(): {
    on: (event: string, fn: (...args: unknown[]) => void) => /*elided*/ any;
    once: (event: string, fn: (...args: unknown[]) => void) => /*elided*/ any;
    off: (event: string, fn: (...args: unknown[]) => void) => /*elided*/ any;
    emit: (event: string, ...args: unknown[]) => void;
};
type RouterOSResponse = Record<string, string>;
/**
 * Configuration options for creating a RouterOS client connection.
 *
 * @example
 * ```ts
 * const client = createRouterOSClient({
 *   host: "192.168.88.1",
 *   ssl: false,
 *   timeout: 15000
 * });
 * ```
 */
export interface RouterOSClientOptions {
    /**
     * Router IP address or hostname (required).
     * @example "192.168.88.1" or "router.example.com"
     */
    host: string;
    /**
     * Port number for the connection.
     * Defaults to 8728 for TCP or 8729 for SSL.
     */
    port?: number;
    /**
     * Enable TLS/SSL connection.
     * When true, uses port 8729 by default.
     * RouterOS uses self-signed certificates by default.
     * @default false
     */
    ssl?: boolean;
    /**
     * Connection attempt timeout in milliseconds.
     * @default 30000
     */
    timeout?: number;
}
/**
 * Creates a RouterOS API client instance bound to a single RouterOS host.
 *
 * Provides a minimal, functional API for connecting, authenticating, and executing
 * commands on MikroTik RouterOS devices. All async operations return a Result object
 * for explicit error handling without throwing exceptions.
 *
 * @param options - Configuration options for the client
 * @returns A client object with methods for connecting, authenticating, and executing commands
 *
 * @example
 * ```ts
 * import { createRouterOSClient } from "ts-router-os";
 *
 * const client = createRouterOSClient({
 *   host: "192.168.88.1",
 *   ssl: false,
 *   timeout: 15000
 * });
 *
 * // Connect to the router
 * const connected = await client.connect();
 * if (!connected.status) return console.error(connected.message);
 *
 * // Authenticate
 * const auth = await client.login("admin", "password");
 * if (!auth.status) return console.error(auth.message);
 *
 * // Execute commands
 * const list = await client.runCommand("/interface/print");
 * if (list.status) {
 *   console.log('Interfaces:', list.data);
 * }
 *
 * // Clean up
 * client.close();
 * ```
 */
export declare function createRouterOSClient(options: RouterOSClientOptions): {
    /**
     * Opens a TCP or TLS socket connection to the RouterOS device.
     *
     * Must be called before `login` or any command execution.
     * Uses the port, SSL, and timeout settings from the client options.
     *
     * @returns A Result indicating connection success or failure
     *
     * @example
     * ```ts
     * const connected = await client.connect();
     * if (!connected.status) {
     *   console.error("Failed to connect:", connected.message);
     *   return;
     * }
     * console.log("Connected successfully!");
     * ```
     */
    connect: () => Promise<Result<void>>;
    /**
     * Authenticates with the RouterOS device using username and password.
     *
     * Automatically handles both legacy and challenge-based authentication flows.
     * The connection must be established via `connect()` before calling this method.
     * Most RouterOS commands require authentication.
     *
     * @param user - RouterOS username (e.g., "admin")
     * @param password - RouterOS password for the user
     * @returns A Result indicating authentication success or failure
     *
     * @example
     * ```ts
     * const auth = await client.login("admin", "mypassword");
     * if (!auth.status) {
     *   console.error("Login failed:", auth.message);
     *   return;
     * }
     * console.log("Authenticated successfully!");
     * ```
     */
    login: (user: string, password: string) => Promise<Result<void>>;
    /**
     * Executes a RouterOS API command and returns the response data.
     *
     * This is the core method for interacting with the RouterOS API. Commands use
     * the RouterOS path format (e.g., `/interface/print`, `/ip/address/add`).
     *
     * Parameters are passed as key-value pairs. Keys starting with `?` are used
     * for filtering/querying. Regular keys are used for setting values.
     *
     * @param cmd - The RouterOS API command path (e.g., "/interface/print")
     * @param params - Key-value pairs for command parameters and filters
     * @returns A Result containing an array of response objects from RouterOS
     *
     * @example
     * ```ts
     * // List all interfaces
     * const interfaces = await client.runCommand("/interface/print");
     * if (interfaces.status) {
     *   console.log(interfaces.data); // Array of interface objects
     * }
     *
     * // Add a new IP address
     * const add = await client.runCommand("/ip/address/add", {
     *   address: "192.168.1.1/24",
     *   interface: "ether1"
     * });
     *
     * // Query with filters (keys starting with ?)
     * const filtered = await client.runCommand("/interface/print", {
     *   "?type": "ether"
     * });
     * ```
     */
    runCommand: (cmd: string, params?: Record<string, string>) => Promise<Result<RouterOSResponse[]>>;
    /**
     * Closes the connection to the RouterOS device and cleans up resources.
     *
     * Destroys the underlying socket connection. This method is synchronous
     * and should be called when you're done using the client.
     *
     * @returns A Result indicating whether the close operation succeeded
     *
     * @example
     * ```ts
     * // When done with the client
     * const result = client.close();
     * if (!result.status) {
     *   console.error("Failed to close connection:", result.message);
     * }
     * ```
     */
    close: () => Result<void>;
    /**
     * Registers an event listener that will be called every time the specified event is emitted.
     *
     * Available events:
     * - `error`: Emitted when a connection error occurs
     * - `close`: Emitted when the connection is closed
     * - `end`: Emitted when the connection ends
     * - `connect`: Emitted when successfully connected
     *
     * @param event - The event name to listen for
     * @param fn - The callback function to execute when the event is emitted
     * @returns The client object for method chaining
     *
     * @example
     * ```ts
     * client.on("error", (err) => {
     *   console.error("Connection error:", err);
     * });
     *
     * client.on("close", () => {
     *   console.log("Connection closed");
     * });
     * ```
     */
    on: (event: string, fn: (...args: unknown[]) => void) => {
        on: /*elided*/ any;
        once: (event: string, fn: (...args: unknown[]) => void) => /*elided*/ any;
        off: (event: string, fn: (...args: unknown[]) => void) => /*elided*/ any;
        emit: (event: string, ...args: unknown[]) => void;
    };
    /**
     * Registers a one-time event listener that will be called only once when the specified event is emitted.
     * After being called once, the listener is automatically removed.
     *
     * Available events:
     * - `error`: Emitted when a connection error occurs
     * - `close`: Emitted when the connection is closed
     * - `end`: Emitted when the connection ends
     * - `connect`: Emitted when successfully connected
     *
     * @param event - The event name to listen for
     * @param fn - The callback function to execute once when the event is emitted
     * @returns The client object for method chaining
     *
     * @example
     * ```ts
     * client.once("connect", () => {
     *   console.log("Connected! This will only log once.");
     * });
     * ```
     */
    once: (event: string, fn: (...args: unknown[]) => void) => {
        on: (event: string, fn: (...args: unknown[]) => void) => /*elided*/ any;
        once: /*elided*/ any;
        off: (event: string, fn: (...args: unknown[]) => void) => /*elided*/ any;
        emit: (event: string, ...args: unknown[]) => void;
    };
    /**
     * Removes a previously registered event listener.
     *
     * @param event - The event name to remove the listener from
     * @param fn - The specific callback function to remove
     * @returns The client object for method chaining
     *
     * @example
     * ```ts
     * const errorHandler = (err) => console.error(err);
     * client.on("error", errorHandler);
     *
     * // Later, remove the listener
     * client.off("error", errorHandler);
     * ```
     */
    off: (event: string, fn: (...args: unknown[]) => void) => {
        on: (event: string, fn: (...args: unknown[]) => void) => /*elided*/ any;
        once: (event: string, fn: (...args: unknown[]) => void) => /*elided*/ any;
        off: /*elided*/ any;
        emit: (event: string, ...args: unknown[]) => void;
    };
    /**
     * Convenience method to retrieve the router's system identity.
     *
     * This is equivalent to calling `runCommand("/system/identity/print")`.
     * Returns information about the router's configured name and identity.
     *
     * @returns A Result containing the system identity data
     *
     * @example
     * ```ts
     * const identity = await client.getSystemIdentity();
     * if (identity.status) {
     *   console.log("Router name:", identity.data[0]?.name);
     * }
     * ```
     */
    getSystemIdentity(): Promise<Result<RouterOSResponse[]>>;
};
export {};
