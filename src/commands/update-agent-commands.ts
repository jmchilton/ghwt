import { setupAgentCommands } from '../lib/agent-commands.js';

export async function updateAgentCommandsCommand(options?: { verbose?: boolean }): Promise<void> {
  console.log('🔄 Updating Claude slash commands...\n');
  await setupAgentCommands(options);
  console.log('\n✨ Claude slash commands updated successfully!');
}
