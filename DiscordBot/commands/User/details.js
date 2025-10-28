const { MessageEmbed } = require("discord.js");
const User = require("../../../model/user.js");
const Profiles = require('../../../model/profiles.js');

module.exports = {
    commandInfo: {
        name: "details",
        description: "Retrieves your account info."
    },
    execute: async (interaction) => {
        await interaction.deferReply({ ephemeral: true });

        const user = await User.findOne({ discordId: interaction.user.id }).lean();
        if (!user) return interaction.editReply({ content: "You do not have a registered account!", ephemeral: true });

        const profile = await Profiles.findOne({ accountId: user?.accountId }).lean();
        const items = profile?.profiles?.common_core?.items || {};
        const currency = items["Currency:MtxPurchased"]?.quantity || 0;

        // Controllo Battle Pass
        const hasBattlePass = Object.keys(items).some(key => key.startsWith("BattlePass:"));

        // Stato online
        let onlineStatus = global.Clients.some(i => i.accountId == user.accountId);

        // Embed
        let embed = new MessageEmbed()
            .setColor("GREEN")
            .setDescription("These are your account details")
            .setFields(
                { name: 'Username:', value: user.username },
                { name: 'Email:', value: `${user.email}` },
                { name: "Online:", value: `${onlineStatus ? "Yes" : "No"}` },
                { name: "Banned:", value: `${user.banned ? "Yes" : "No"}` },
                { name: 'V-Bucks:', value: `${currency} V-Bucks` },
                { name: 'Battle Pass:', value: hasBattlePass ? "Yes" : "No" },
                { name: "Account ID:", value: user.accountId }
            )
            .setTimestamp()
            .setThumbnail(interaction.user.avatarURL())
            .setFooter({
                text: "Cosmic",
            });

        interaction.editReply({ embeds: [embed], ephemeral: true });
    }
}
