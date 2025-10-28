const { MessageEmbed } = require("discord.js");
const User = require("../../../model/user.js");
const functions = require("../../../structs/functions.js");

module.exports = {
    commandInfo: {
        name: "create",
        description: "Creates an account on Reload Backend.",
        options: [
            {
                name: "email",
                description: "Your email.",
                required: true,
                type: 3
            },
            {
                name: "password",
                description: "Your password.",
                required: true,
                type: 3
            }
        ],
    },

    execute: async (interaction) => {
        await interaction.deferReply({ ephemeral: true });

        const { options } = interaction;
        const discordId = interaction.user.id;
        const email = options.get("email").value;
        const password = options.get("password").value;
        const username = interaction.user.username;

        // 1. Controlla formato email
        const emailRegex = /^([a-zA-Z0-9_.\-])+@(([a-zA-Z0-9\-])+\.)+([a-zA-Z0-9]{2,})+$/;
        if (!emailRegex.test(email)) {
            return interaction.editReply({ content: "❌ You did not provide a valid email address!", ephemeral: true });
        }

        // 2. Controlla se già esistono utente/email
        const existingEmail = await User.findOne({ email });
        const existingUser = await User.findOne({ username });

        if (existingEmail) {
            return interaction.editReply({ content: "❌ Email is already in use. Please choose another one.", ephemeral: true });
        }

        if (existingUser) {
            return interaction.editReply({ content: "❌ Username already exists. Please change your Discord username or contact support.", ephemeral: true });
        }

        // 3. Controlla lunghezza password
        if (password.length < 4 || password.length > 128) {
            return interaction.editReply({
                content: "❌ Your password must be between 4 and 128 characters long.",
                ephemeral: true
            });
        }

        // 4. Chiama funzione di registrazione
        try {
            const resp = await functions.registerUser(discordId, username, email, password);

            const embed = new MessageEmbed()
                .setColor(resp.status >= 400 ? "#ff0000" : "#56ff00")
                .setThumbnail(interaction.user.avatarURL({ format: 'png', dynamic: true, size: 256 }))
                .addFields(
                    { name: "Message", value: resp.status >= 400 ? "An error occurred." : "✅ Successfully created an account." },
                    { name: "Username", value: username },
                    { name: "Discord Tag", value: interaction.user.tag }
                )
                .setTimestamp()
                .setFooter({ text: "Cosmic" });

            if (resp.status >= 400) {
                return interaction.editReply({ embeds: [embed], ephemeral: true });
            }

            // 5. Manda conferma in DM o canale
            const targetChannel = interaction.channel ?? interaction.user;
            targetChannel.send({ embeds: [embed] }).catch(() => {
                // Se non può inviare messaggi nel canale o DM, ignora
            });

            return interaction.editReply({ content: "✅ You successfully created an account!", ephemeral: true });
        } catch (err) {
            console.error("Error in /create command:", err);
            return interaction.editReply({
                content: "❌ An unexpected error occurred while creating the account.",
                ephemeral: true
            });
        }
    }
};
