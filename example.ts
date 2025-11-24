import { createRouterOSClient } from './index.ts';

(async () => {
  const client = createRouterOSClient({ host: '127.0.0.1', ssl: false });

  // lifecycle events
  client.on('close', () => console.log('⚠️ RouterOS socket closed'));
  client.on('error', (err: unknown) =>
    console.error('❌ RouterOS error:', err)
  );
  client.on('end', () => console.log('🔌 RouterOS connection ended'));

  try {
    await client.connect();
    console.log('✅ Connected to RouterOS');

    await client.login('admin', 'password');
    console.log('🔑 Logged in successfully');

    // Run system identity command
    const identity = await client.getSystemIdentity();
    console.log('🖥️ Router identity:', identity);

    // Run another command, e.g. check resources
    const resources = await client.runCommand('/system/resource/print');
    console.log('📊 Router resources:', resources);

    // Close connection gracefully
    client.close();
    console.log('🔌 Connection closed');
  } catch (err) {
    console.error('❌ Failed:', (err as Error).message);
  }
})();
