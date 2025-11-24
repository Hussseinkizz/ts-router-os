import { describe, it, expect, vi } from "vitest";
import { createEmitter } from "./index.js";

describe("createEmitter", () => {
	it("should create an emitter with all methods", () => {
		const emitter = createEmitter();
		expect(emitter).toHaveProperty("on");
		expect(emitter).toHaveProperty("once");
		expect(emitter).toHaveProperty("off");
		expect(emitter).toHaveProperty("emit");
	});

	it("should register and call event listeners", () => {
		const emitter = createEmitter();
		const listener = vi.fn();

		emitter.on("test", listener);
		emitter.emit("test", "hello", 42);

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith("hello", 42);
	});

	it("should call multiple listeners for the same event", () => {
		const emitter = createEmitter();
		const listener1 = vi.fn();
		const listener2 = vi.fn();

		emitter.on("test", listener1);
		emitter.on("test", listener2);
		emitter.emit("test", "data");

		expect(listener1).toHaveBeenCalledWith("data");
		expect(listener2).toHaveBeenCalledWith("data");
	});

	it("should support method chaining with on()", () => {
		const emitter = createEmitter();
		const listener1 = vi.fn();
		const listener2 = vi.fn();

		const result = emitter.on("test1", listener1).on("test2", listener2);

		expect(result).toBe(emitter);
		emitter.emit("test1");
		emitter.emit("test2");
		expect(listener1).toHaveBeenCalled();
		expect(listener2).toHaveBeenCalled();
	});

	it("should call once() listeners only once", () => {
		const emitter = createEmitter();
		const listener = vi.fn();

		emitter.once("test", listener);
		emitter.emit("test", 1);
		emitter.emit("test", 2);
		emitter.emit("test", 3);

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith(1);
	});

	it("should support method chaining with once()", () => {
		const emitter = createEmitter();
		const listener = vi.fn();

		const result = emitter.once("test", listener);

		expect(result).toBe(emitter);
	});

	it("should remove listeners with off()", () => {
		const emitter = createEmitter();
		const listener = vi.fn();

		emitter.on("test", listener);
		emitter.emit("test");
		expect(listener).toHaveBeenCalledTimes(1);

		emitter.off("test", listener);
		emitter.emit("test");
		expect(listener).toHaveBeenCalledTimes(1); // Still 1, not called again
	});

	it("should support method chaining with off()", () => {
		const emitter = createEmitter();
		const listener1 = vi.fn();
		const listener2 = vi.fn();

		emitter.on("test1", listener1);
		emitter.on("test2", listener2);

		const result = emitter.off("test1", listener1).off("test2", listener2);

		expect(result).toBe(emitter);
	});

	it("should only remove the specific listener", () => {
		const emitter = createEmitter();
		const listener1 = vi.fn();
		const listener2 = vi.fn();

		emitter.on("test", listener1);
		emitter.on("test", listener2);

		emitter.off("test", listener1);
		emitter.emit("test");

		expect(listener1).not.toHaveBeenCalled();
		expect(listener2).toHaveBeenCalled();
	});

	it("should handle removing non-existent listeners gracefully", () => {
		const emitter = createEmitter();
		const listener = vi.fn();

		expect(() => emitter.off("nonexistent", listener)).not.toThrow();
	});

	it("should handle emitting events with no listeners", () => {
		const emitter = createEmitter();

		expect(() => emitter.emit("nonexistent", "data")).not.toThrow();
	});

	it("should support multiple event types", () => {
		const emitter = createEmitter();
		const dataListener = vi.fn();
		const errorListener = vi.fn();

		emitter.on("data", dataListener);
		emitter.on("error", errorListener);

		emitter.emit("data", "hello");
		emitter.emit("error", new Error("oops"));

		expect(dataListener).toHaveBeenCalledWith("hello");
		expect(errorListener).toHaveBeenCalledWith(expect.any(Error));
	});

	it("should pass multiple arguments to listeners", () => {
		const emitter = createEmitter();
		const listener = vi.fn();

		emitter.on("test", listener);
		emitter.emit("test", 1, "two", { three: 3 }, [4, 5, 6]);

		expect(listener).toHaveBeenCalledWith(1, "two", { three: 3 }, [4, 5, 6]);
	});

	it("should clean up event when all listeners are removed", () => {
		const emitter = createEmitter();
		const listener1 = vi.fn();
		const listener2 = vi.fn();

		emitter.on("test", listener1);
		emitter.on("test", listener2);

		emitter.off("test", listener1);
		emitter.off("test", listener2);

		// Event should be cleaned up internally
		emitter.emit("test", "data");
		expect(listener1).not.toHaveBeenCalled();
		expect(listener2).not.toHaveBeenCalled();
	});

	it("should handle adding the same listener multiple times", () => {
		const emitter = createEmitter();
		const listener = vi.fn();

		emitter.on("test", listener);
		emitter.on("test", listener); // Add same listener again

		emitter.emit("test");

		// Set prevents duplicates, so should only be called once
		expect(listener).toHaveBeenCalledTimes(1);
	});
});
