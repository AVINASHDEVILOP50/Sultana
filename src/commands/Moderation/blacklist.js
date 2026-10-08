import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { BlacklistService } from '../../services/moderation/blacklistService.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';

export default {
    data: new SlashCommandBuilder()
        .setName('blacklist')
        .setDescription('Hide all server channels from a user')
        .addUserOption((option) =>
            option
                .setName('target')
                .setDescription('The user to blacklist')
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('reason')
                .setDescription('Reason for the blacklist'),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    category: 'moderation',

    async execute(interaction, config, client) {
        const user = interaction.options.getUser('target');
        const reason =
            interaction.options.getString('reason') || 'No reason provided';

        if (!user) {
            throw new TitanBotError(
                'Missing target user',
                ErrorTypes.USER_INPUT,
                'You must specify a user to blacklist.',
                { subtype: 'invalid_user' },
            );
        }

        if (user.id === interaction.user.id) {
            throw new TitanBotError(
                'Cannot blacklist self',
                ErrorTypes.VALIDATION,
                'You cannot blacklist yourself.',
            );
        }

        if (user.id === client.user.id) {
            throw new TitanBotError(
                'Cannot blacklist bot',
                ErrorTypes.VALIDATION,
                'You cannot blacklist the bot.',
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

        const result = await BlacklistService.blacklistUser({
            guild: interaction.guild,
            member,
            moderator: interaction.member,
            reason,
        });

        await InteractionHelper.universalReply(interaction, {
            embeds: [
                successEmbed(
                    `🔒 **Blacklisted** ${user.tag}`,
                    `**Reason:** ${reason}\n**Action:** All server channels have been hidden from this user.`,
                ),
            ],
        });
    },
};
