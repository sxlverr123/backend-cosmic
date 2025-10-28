const { MessageEmbed } = require("discord.js");
const Users = require("../../../model/user.js");

module.exports = {
    commandInfo: {
        name: "lookup",
        description: "Search for a Discord user's ID by providing their in-game username.",
        options: [
            {
                name: "user",
                description: "Target username.",
                required: true,
                type: 3
            }
        ]
    },
    execute: async (interaction) => {
        await interaction.deferReply({ ephemeral: true });

        // Role ID check
        const requiredRoleId = "1429059711717736569";
        const member = interaction.member;

        if (!member.roles.cache.has(requiredRoleId)) {
            return interaction.editReply({
                content: "You dont have the permission to use this command.",
                ephemeral: true
            });
        }

        const { options } = interaction;

        const user = await Users.findOne({ username_lower: (options.get("user").value).toLowerCase() }).lean();
        if (!user) return interaction.editReply({ content: "L'username inserito non esiste.", ephemeral: true });

        let onlineStatus = global.Clients.some(i => i.accountId == user.accountId);

        let embed = new MessageEmbed()
            .setColor("GREEN")
            .setDescription(
                `**User Information:**\n- **Discord User:** <@${user.discordId}>\n- **DiscordID:** ${user.discordId}\n- **In-Game Username:** ${user.username}\n- **Banned:** ${user.banned ? "Yes" : "No"}\n- **Online:** ${onlineStatus ? "Yes" : "No"}`
            );

        interaction.editReply({ embeds: [embed], ephemeral: true });
    }
}
