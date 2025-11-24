import net from "node:net";
import tls from "node:tls";
import { createHash } from "node:crypto";

// ------------------ Result Pattern Types ------------------

export type Result<T> =
	| { status: true; data: T }
	| { status: false; message: string; error?: unknown };

// ------------------ Event Emitter ------------------

class SimpleEmitter {
	private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

	on(event: string, fn: (...args: unknown[]) => void) {
		let set = this.listeners.get(event);
		if (!set) {
			set = new Set();
			this.listeners.set(event, set);
		}
		set.add(fn);
		return this;
	}

	once(event: string, fn: (...args: unknown[]) => void) {
		const wrapper = (...args: unknown[]) => {
			this.off(event, wrapper);
			fn(...args);
		};
		return this.on(event, wrapper);
	}

	off(event: string, fn: (...args: unknown[]) => void) {
		const set = this.listeners.get(event);
		if (set) {
			set.delete(fn);
			if (set.size === 0) this.listeners.delete(event);
		}
		return this;
	}

	emit(event: string, ...args: unknown[]) {
		const set = this.listeners.get(event);
		if (set) for (const fn of set) fn(...args);
	}
}

// ------------------ Types ------------------

type RouterOSResponse = Record<string, string>;

export interface RouterOSClientOptions {
	host: string;
	port?: number;
	ssl?: boolean;
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

export function createRouterOSClient(options: RouterOSClientOptions) {
	let socket: net.Socket | tls.TLSSocket | null = null;
	const events = new SimpleEmitter();

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
		on: events.on.bind(events),
		once: events.once.bind(events),
		off: events.off.bind(events),
		getSystemIdentity() {
			return runCommand("/system/identity/print");
		},
	};
}
