import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { BlacklistService } from '../../services/moderation/blacklistService.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';

export default {
    data: new SlashCommandBuilder()
        .setName('unblacklist')
        .setDescription('Restore a blacklisted user\'s channel access')
        .addUserOption((option) =>
            option
                .setName('target')
                .setDescription('The user to unblacklist')
                .setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    category: 'moderation',

    async execute(interaction, config, client) {
        const user = interaction.options.getUser('target');

        if (!user) {
            throw new TitanBotError(
                'Missing target user',
                ErrorTypes.USER_INPUT,
                'You must specify a user to unblacklist.',
                { subtype: 'invalid_user' },
            );
        }

        const member = await interaction.guild.members
            .fetch(user.id)
            .catch(() => null);

        if (!member) {
            throw new TitanBotError(
                'User not found',
                ErrorTypes.USER_INPUT,
                'That user is not currently a member of this server.',
            );
        }

        const result = await BlacklistService.unblacklistUser({
            guild: interaction.guild,
            member,
            moderator: interaction.member,
        });

        await InteractionHelper.universalReply(interaction, {
            embeds: [
                successEmbed(
                    `🔓 **Unblacklisted** ${user.tag}`,
                    `The user's previous channel permissions have been restored.`,
                ),
            ],
        });
    },
};
