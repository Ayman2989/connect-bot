export const name = "interactionCreate";
export const once = false;

export async function execute(interaction, client) {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction, client);
    } catch (err) {
      console.error(err);
      await interaction.reply({
        content: "⚠️ There was an error executing this command.",
        ephemeral: true,
      });
    }
  }

  // Handle dropdown (select menu)
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === "coinSelect") {
      const coin = interaction.values[0];
      await interaction.reply({
        content: `💰 You selected **${coin}**!`,
        ephemeral: true,
      });
    }
  }
}
