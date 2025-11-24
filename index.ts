import net from "node:net";
import tls from "node:tls";
import { createHash } from "node:crypto";

// ------------------ Result Pattern Types ------------------

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
export type Result<T> =
	| { status: true; data: T }
	| { status: false; message: string; error?: unknown };

// ------------------ Event Emitter ------------------

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
export function createEmitter() {
	const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

	function on(event: string, fn: (...args: unknown[]) => void) {
		let set = listeners.get(event);
		if (!set) {
			set = new Set();
			listeners.set(event, set);
		}
		set.add(fn);
		return emitter;
	}

	function once(event: string, fn: (...args: unknown[]) => void) {
		const wrapper = (...args: unknown[]) => {
			off(event, wrapper);
			fn(...args);
		};
		return on(event, wrapper);
	}

	function off(event: string, fn: (...args: unknown[]) => void) {
		const set = listeners.get(event);
		if (set) {
			set.delete(fn);
			if (set.size === 0) listeners.delete(event);
		}
		return emitter;
	}

	function emit(event: string, ...args: unknown[]) {
		const set = listeners.get(event);
		if (set) for (const fn of set) fn(...args);
	}

	const emitter = { on, once, off, emit };
	return emitter;
}

// ------------------ Types ------------------

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

// ------------------ Encoding / Decoding helpers ------------------

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
	let totalLength = 0;
	for (const arr of arrays) totalLength += arr.length;
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const arr of arrays) {
		result.set(arr, offset);
		offset += arr.length;
	}
	return result;
}

function encodeLength(len: number): Uint8Array {
	if (len < 0x80) return new Uint8Array([len]);
	if (len < 0x4000) return new Uint8Array([(len >> 8) | 0x80, len & 0xff]);
	if (len < 0x200000)
		return new Uint8Array([(len >> 16) | 0xc0, (len >> 8) & 0xff, len & 0xff]);
	if (len < 0x10000000)
		return new Uint8Array([
			(len >> 24) | 0xe0,
			(len >> 16) & 0xff,
			(len >> 8) & 0xff,
			len & 0xff,
		]);
	return new Uint8Array([
		0xf0,
		(len >> 24) & 0xff,
		(len >> 16) & 0xff,
		(len >> 8) & 0xff,
		len & 0xff,
	]);
}

function encodeWord(word: string): Uint8Array {
	const encoder = new TextEncoder();
	const wordBuf = encoder.encode(word);
	const lenBuf = encodeLength(wordBuf.length);
	return concatUint8Arrays([lenBuf, wordBuf]);
}

function decodeLength(
	buffer: Uint8Array,
	offset = 0,
): { length: number; bytes: number } | null {
	if (offset >= buffer.length) return null;
	const first = buffer[offset];
	if (!first || first === 0) return { length: 0, bytes: 1 };
	if ((first & 0x80) === 0) return { length: first, bytes: 1 };
	if ((first & 0xc0) === 0x80)
		return {
			length: ((first & 0x3f) << 8) | (buffer[offset + 1] ?? 0),
			bytes: 2,
		};
	if ((first & 0xe0) === 0xc0)
		return {
			length:
				((first & 0x1f) << 16) |
				((buffer[offset + 1] ?? 0) << 8) |
				(buffer[offset + 2] ?? 0),
			bytes: 3,
		};
	if ((first & 0xf0) === 0xe0)
		return {
			length:
				((first & 0x0f) << 24) |
				((buffer[offset + 1] ?? 0) << 16) |
				((buffer[offset + 2] ?? 0) << 8) |
				(buffer[offset + 3] ?? 0),
			bytes: 4,
		};
	if (first === 0xf0)
		return {
			length:
				((buffer[offset + 1] ?? 0) << 24) |
				((buffer[offset + 2] ?? 0) << 16) |
				((buffer[offset + 3] ?? 0) << 8) |
				(buffer[offset + 4] ?? 0),
			bytes: 5,
		};
	return null;
}

function parseSentences(buffer: Uint8Array): {
	sentences: string[][];
	rest: Uint8Array;
} {
	const sentences: string[][] = [];
	let offset = 0;
	const decoder = new TextDecoder();
	while (offset < buffer.length) {
		const sentence: string[] = [];
		while (offset < buffer.length) {
			const lenInfo = decodeLength(buffer, offset);
			if (!lenInfo) return { sentences, rest: buffer.slice(offset) };
			offset += lenInfo.bytes;
			if (lenInfo.length === 0) break;
			if (offset + lenInfo.length > buffer.length)
				return { sentences, rest: buffer.slice(offset - lenInfo.bytes) };
			const word = decoder.decode(
				buffer.slice(offset, offset + lenInfo.length),
			);
			sentence.push(word);
			offset += lenInfo.length;
		}
		if (sentence.length > 0) sentences.push(sentence);
	}
	return { sentences, rest: new Uint8Array(0) };
}

function toObjects(sentences: string[][]): RouterOSResponse[] {
	return sentences
		.filter((s) => s[0] === "!re")
		.map((s) =>
			s.slice(1).reduce<RouterOSResponse>((acc, item) => {
				if (item.startsWith("=")) {
					const [k, ...v] = item.slice(1).split("=");
					if (typeof k !== "undefined") acc[k] = v.join("=");
				}
				return acc;
			}, {}),
		);
}

// ------------------ Factory client ------------------

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
export function createRouterOSClient(options: RouterOSClientOptions) {
	let socket: net.Socket | tls.TLSSocket | null = null;
	const events = createEmitter();

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
	async function connect(): Promise<Result<void>> {
		const { host, port, ssl, timeout } = {
			port: options.ssl ? 8729 : 8728,
			timeout: 30000,
			ssl: false,
			...options,
		};

		try {
			await new Promise<void>((resolve, reject) => {
				try {
					const s = ssl
						? tls.connect({ host, port, timeout }, () => resolve())
						: net.connect({ host, port, timeout }, () => resolve());

					socket = s;
					s.on("connect", () => events.emit("connect"));
					s.on("error", (err) => {
						events.emit("error", err);
						reject(err);
					});
					s.on("close", () => events.emit("close"));
					s.on("end", () => events.emit("end"));
				} catch (err) {
					events.emit("error", err);
					reject(err);
				}
			});
			return { status: true, data: undefined };
		} catch (err) {
			return {
				status: false,
				message: `Failed to connect to ${host}:${port}: ${(err as Error).message}`,
				error: err,
			};
		}
	}

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
	async function login(user: string, password: string): Promise<Result<void>> {
		try {
			const reply = await runCommand("/login", { name: user, password });
			if (!reply.status) {
				const { message, error } = reply as { status: false; message: string; error?: unknown };
				return { status: false, message, error };
			}

			const ret = reply.data
				.flatMap((r) => Object.entries(r))
				.find(([k]) => k === "ret")?.[1];

			if (ret) {
				const challenge = new Uint8Array(
					ret.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
				);
				const passwordBytes = new TextEncoder().encode(password);
				const data = new Uint8Array(1 + passwordBytes.length + challenge.length);
				data.set([0], 0);
				data.set(passwordBytes, 1);
				data.set(challenge, 1 + passwordBytes.length);
				const digest = createHash("md5").update(Buffer.from(data)).digest();
				const response =
					"00" +
					Array.from(digest)
						.map((b: number) => b.toString(16).padStart(2, "0"))
						.join("");
				const finalLoginRes = await runCommand("/login", { name: user, response });
				if (!finalLoginRes.status) {
					const { message, error } = finalLoginRes as { status: false; message: string; error?: unknown };
					return { status: false, message, error };
				}
				return { status: true, data: undefined };
			}
			return { status: true, data: undefined };
		} catch (err) {
			return {
				status: false,
				message: `Login failed: ${(err as Error).message}`,
				error: err,
			};
		}
	}

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
	function runCommand(
		cmd: string,
		params: Record<string, string> = {},
	): Promise<Result<RouterOSResponse[]>> {
		if (!socket) {
			return Promise.resolve({
				status: false,
				message: "Not connected",
			});
		}

		return new Promise((resolve) => {
			const s = socket as net.Socket;
			const parts = [
				cmd,
				...Object.entries(params).map(([k, v]) => `=${k}=${v}`),
			];
			const data = concatUint8Arrays([
				...parts.map(encodeWord),
				new Uint8Array([0]),
			]);

			const responses: string[][] = [];
			let readBuffer: Uint8Array = new Uint8Array(0);

			const onData = (chunk: Buffer) => {
				const chunkData = new Uint8Array(chunk);
				readBuffer = concatUint8Arrays([readBuffer, chunkData]);
				const { sentences, rest } = parseSentences(readBuffer);
				readBuffer = new Uint8Array(rest);
				for (const sent of sentences) {
					if (sent[0] === "!trap") {
						cleanup();
						resolve({
							status: false,
							message:
								sent.find((x) => x.startsWith("=message="))?.slice(9) ??
								"Trap error",
						});
						return;
					}
					if (sent[0] === "!fatal") {
						cleanup();
						resolve({
							status: false,
							message: "Fatal error: " + sent.slice(1).join(" "),
						});
						return;
					}
					responses.push(sent);
					if (sent[0] === "!done") {
						cleanup();
						resolve({ status: true, data: toObjects(responses) });
						return;
					}
				}
			};

			const onError = (err: Error) => {
				cleanup();
				resolve({ status: false, message: err.message, error: err });
			};
			const onClose = () => {
				cleanup();
				resolve({ status: false, message: "Connection closed" });
			};
			const onEnd = () => {
				cleanup();
				resolve({ status: false, message: "Connection ended" });
			};

			function cleanup() {
				s.off("data", onData);
				s.off("error", onError);
				s.off("close", onClose);
				s.off("end", onEnd);
			}

			s.on("data", onData);
			s.on("error", onError);
			s.on("close", onClose);
			s.on("end", onEnd);

			s.write(Buffer.from(data));
		});
	}

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
	function close(): Result<void> {
		try {
			socket?.destroy();
			events.emit("close");
			return { status: true, data: undefined };
		} catch (err) {
			events.emit("error", err);
			return {
				status: false,
				message: (err as Error).message,
				error: err,
			};
		}
	}

	return {
		connect,
		login,
		runCommand,
		close,
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
		on: events.on.bind(events),
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
		once: events.once.bind(events),
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
		off: events.off.bind(events),
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
		getSystemIdentity() {
			return runCommand("/system/identity/print");
		},
	};
}
