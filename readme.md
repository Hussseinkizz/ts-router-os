# RouterOS TypeScript Client

A minimal, working TypeScript client for MikroTik RouterOS API.
Supports TCP and SSL connections, old login method, and incremental command execution.

## Features

* Connects to RouterOS via TCP (8728) or SSL (8729)
* Supports both old and new login methods
* Functional factory-style API with result pattern
* Handles word encoding/decoding for RouterOS API
* Sends commands and parses responses into objects
* Incrementally extendable with custom helpers
* Generic `runCommand` method for any RouterOS API command
* Event handling for `error`, `close`, and `end`

## Installation

```bash
pnpm add ts-router-os
```

`ts-router-os` exposes a small synchronous/async API. Every async operation returns a Result object so callers decide how to branch. No operational exceptions are thrown for expected failures (auth, timeouts, traps) instead errors are handled and returned explicitly in as below:

```typescript
const result = await client.runCommand("/system/identity/print");
if(!result.status) {
  console.log('something wrong happened ->', result.message);
  console.log('error ->', result.error); // actual error object
}

if(result.status) {
  console.log('everything went well ->', result.data); // what router sent back
}
```

## Overview And Usage

`ts-router-os` provides minimal primitives to connect, authenticate, execute commands, observe events and handle results explicitly as below.

## 1. Client Creation

Create a client bound to a single RouterOS host.

```ts
import { createRouterOSClient } from "ts-router-os";
const client = createRouterOSClient({ host: "123.166.88.1", ssl: false, timeout: 15000 });
```

You would replace `123.166.88.1` with your router ip or remote address.

### 1.1 Options

* **`host`**: Router address (required)
* **`port`**: Override default port (defaults 8728 or 8729 if `ssl` is true)
* **`ssl`**: Enable TLS (uses port 8729 if not explicitly set)
* **`timeout`**: Connection attempt timeout in milliseconds

## 1.2. Connection (`connect`)

Opens the TCP/TLS socket.

```ts
const connected = await client.connect();
if (!connected.status) return console.error(connected.message);
```

Note: Call connect before `login` or any command.

## 1.3. Authentication (`login`)

Authenticates using either legacy or challenge flow automatically.
You put username and password for a user on your router with full access.

```ts
const auth = await client.login("admin", "password");
if (!auth.status) return console.error(auth.message);
```

Required for most commands.

## 1.4. Command Execution (`runCommand`)

Primary primitive for issuing RouterOS API commands.

```ts
// List interfaces
const list = await client.runCommand("/interface/print");

// Add IP address (you would use your router address, not 123.XXX)
const added = await client.runCommand("/ip/address/add", { address: "123.166.1.2/24", interface: "ether1" });

// Filtered query (prefix with '?')
const filtered = await client.runCommand("/ip/address/print", { "?interface": "ether1" });
```

On success `data` is `RouterOSResponse[]` (array of plain field maps). On failure inspect `message`.

### 1.5 Params Rules

* Plain key: becomes `=key=value`

* Filter key: prefix with `?` (e.g. `"?interface"`)

## 1.6. Identity (`getSystemIdentity`)

Convenience wrapper for `/system/identity/print`.

```ts
const id = await client.getSystemIdentity();
if (id.status) console.log(id.data);
```

## 1.7. Events (`on`)

Register handlers for lifecycle events.

```ts
client.on("error", (e) => console.error(e));
client.on("close", () => console.log("closed"));
client.on("end", () => console.log("ended"));
```

### 1.8 Event List

* **`error`**: Underlying socket/protocol issue

* **`close`**: Socket closed locally or remotely
* **`end`**: Remote end finished sending data

## 1.9. Closing (`close`)

Synchronous operation ending the connection.

```ts
const closed = client.close();
if (!closed.status) console.error(closed.message);
```

## 1.10. Types Reference

```ts
interface RouterOSClientOptions {
  host: string;
  port?: number;
  ssl?: boolean;
  timeout?: number;
}

type RouterOSResponse = Record<string, string>;

type Result<T> =
  | { status: true; data: T }
  | { status: false; message: string; error?: unknown };
```

## 2. Usage Flow

1. Create client
2. Connect
3. Login
4. Run one or more commands
5. Close when done

Early return on any failure to keep flow clear.

```ts
import { createRouterOSClient } from "ts-router-os";
const client = createRouterOSClient({ host: "123.166.88.1", ssl: false, timeout: 15000 });

const connected = await client.connect();
if (!connected.status) return console.error(connected.message);

const auth = await client.login("kizz", "12345678");
if (!auth.status) return console.error(auth.message);

const list = await client.runCommand("/interface/print");
if (!list.status) return console.error(list.message);

console.log('retrieved list', list.data);

client.close();
```

## Extending

You can add helpers of your own:

```ts
client.getSystemIdentity = async () => {
  return await client.runCommand("/system/identity/print");
};

const identity = await client.getSystemIdentity();
```

## Common Issues & Troubleshooting

### 1. Connection Timeout

**Symptoms:** `{ status: false, message: "Failed to connect..." }`

**Causes & Fixes:**

* Router IP is unreachable or wrong
* Port (8728/8729) is blocked by firewall
* RouterOS API service is disabled

✅ Fix: Enable API in `IP > Services` and allow it in firewall rules.

---

### 2. Login Failure

**Symptoms:** `{ status: false, message: "Trap error: invalid user name or password" }`

✅ Fix: Check credentials and ensure the account has API access.

---

### 3. Empty or Unexpected Results

* Some commands require parameters (e.g., queries need `?field=value`).
* Example:

```ts
const result = await client.runCommand("/ip/address/print", {
  "?interface": "ether1"
});
```

### 3. More Important Notes

* RouterOS uses self-signed certificates by default.
* Certificates don’t need validation — the client disables strict checks.
* If `ssl: true` use port `8729`.
* If `ssl: false` use port `8728`.
* If errors packet too long, try disabling ssl
* Default ports: `8728` (TCP) and `8729` (SSL)
* Socket is kept alive automatically
* Generic `runCommand` allows any RouterOS command
* Responses are parsed into objects for easier consumption
* Empty array response means no rows / no matches.
* Most state-changing commands require authentication.
* Filters reduce returned rows; always prefix with `?`.

## Contributions And License

This library is open source, free to use and modify, and contributions are all welcome, or reach out for consultation, would be happy to help.

**Author:** [Hussein Kizz](https://github.com/Hussseinkizz)
