import { PermissionFlagsBits } from 'discord.js';
import { db } from '../../../database/wrapper.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';

function getBlacklistKey(guildId, userId) {
    return `moderation:blacklist:${guildId}:${userId}`;
}

function serializeOverwrite(overwrite) {
    if (!overwrite) {
        return null;
    }

    return {
        allow: overwrite.allow.toArray(),
        deny: overwrite.deny.toArray(),
    };
}

export class BlacklistService {
    static async blacklistUser({
        guild,
        member,
        moderator,
        reason = 'No reason provided',
    }) {
        if (!guild || !member || !moderator) {
            throw new TitanBotError(
                'Missing required parameters',
                ErrorTypes.VALIDATION,
                'Guild, member, and moderator are required.',
            );
        }

        if (member.id === guild.ownerId) {
            throw new TitanBotError(
                'Cannot blacklist server owner',
                ErrorTypes.PERMISSION,
                'The server owner cannot be blacklisted.',
            );
        }

        if (member.id === guild.client.user.id) {
            throw new TitanBotError(
                'Cannot blacklist bot',
                ErrorTypes.VALIDATION,
                'You cannot blacklist the bot.',
            );
        }

        if (member.permissions.has(PermissionFlagsBits.Administrator)) {
            throw new TitanBotError(
                'Administrator cannot be blacklisted',
                ErrorTypes.PERMISSION,
                'This user has **Administrator** permission. Discord Administrators bypass channel permission denies, so I cannot hide all channels from them.',
            );
        }

        const moderatorCanManageChannels = moderator.permissions.has(
            PermissionFlagsBits.ManageChannels,
        );

        const moderatorIsAdmin = moderator.permissions.has(
            PermissionFlagsBits.Administrator,
        );

        if (!moderatorCanManageChannels && !moderatorIsAdmin) {
            throw new TitanBotError(
                'Missing permission',
                ErrorTypes.PERMISSION,
                'You need **Manage Channels** or **Administrator** permission to blacklist users.',
            );
        }

        const botMember = guild.members.me;

        if (!botMember) {
            throw new TitanBotError(
                'Bot member unavailable',
                ErrorTypes.PERMISSION,
                'I could not resolve my member information in this server.',
            );
        }

        if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
            throw new TitanBotError(
                'Missing bot permission',
                ErrorTypes.PERMISSION,
                'I need the **Manage Channels** permission to blacklist users.',
            );
        }

        const key = getBlacklistKey(guild.id, member.id);

        const existing = await db.get(key, null);

        if (existing) {
            throw new TitanBotError(
                'User already blacklisted',
                ErrorTypes.VALIDATION,
                `**${member.user.tag}** is already blacklisted.`,
            );
        }

        const channelSnapshots = [];

        try {
            const channels = [...guild.channels.cache.values()];

            for (const channel of channels) {
                const existingOverwrite =
                    channel.permissionOverwrites.cache.get(member.id);

                channelSnapshots.push({
                    channelId: channel.id,
                    overwrite: serializeOverwrite(existingOverwrite),
                });
            }

            for (const channel of channels) {
                await channel.permissionOverwrites.edit(member.id, {
                    ViewChannel: false,
                });
            }

            const blacklistData = {
                userId: member.id,
                guildId: guild.id,
                moderatorId: moderator.id,
                reason,
                createdAt: new Date().toISOString(),
                channelSnapshots,
            };

            try {
                await db.set(key, blacklistData);
            } catch (dbError) {
                logger.error(
                    'Failed to save blacklist data. Rolling back channel permissions.',
                    dbError,
                );

                for (const snapshot of channelSnapshots) {
                    const channel = guild.channels.cache.get(snapshot.channelId);

                    if (!channel) {
                        continue;
                    }

                    if (snapshot.overwrite) {
                        await channel.permissionOverwrites.edit(member.id, {
                            allow: snapshot.overwrite.allow,
                            deny: snapshot.overwrite.deny,
                        }).catch(() => {});
                    } else {
                        await channel.permissionOverwrites.delete(member.id).catch(() => {});
                    }
                }

                throw new TitanBotError(
                    'Blacklist database failure',
                    ErrorTypes.DATABASE,
                    'The blacklist could not be saved to the database, so no permissions were changed permanently.',
                );
            }

            logger.info(
                `User blacklisted: ${member.user.tag} by ${moderator.user.tag} in ${guild.name}`,
            );

            return {
                user: member.user.tag,
                userId: member.id,
                reason,
            };
        } catch (error) {
            logger.error(
                `Error blacklisting ${member.user?.tag ?? member.id}:`,
                error,
            );

            throw error;
        }
    }

    static async unblacklistUser({
        guild,
        member,
        moderator,
    }) {
        if (!guild || !member || !moderator) {
            throw new TitanBotError(
                'Missing required parameters',
                ErrorTypes.VALIDATION,
                'Guild, member, and moderator are required.',
            );
        }

        const moderatorCanManageChannels = moderator.permissions.has(
            PermissionFlagsBits.ManageChannels,
        );

        const moderatorIsAdmin = moderator.permissions.has(
            PermissionFlagsBits.Administrator,
        );

        if (!moderatorCanManageChannels && !moderatorIsAdmin) {
            throw new TitanBotError(
                'Missing permission',
                ErrorTypes.PERMISSION,
                'You need **Manage Channels** or **Administrator** permission to unblacklist users.',
            );
        }

        const key = getBlacklistKey(guild.id, member.id);
        const blacklistData = await db.get(key, null);

        if (!blacklistData) {
            throw new TitanBotError(
                'User not blacklisted',
                ErrorTypes.VALIDATION,
                `**${member.user.tag}** is not blacklisted.`,
            );
        }

        try {
            for (const snapshot of blacklistData.channelSnapshots || []) {
                const channel = guild.channels.cache.get(snapshot.channelId);

                if (!channel) {
                    continue;
                }

                if (snapshot.overwrite) {
                    await channel.permissionOverwrites.edit(member.id, {
                        allow: snapshot.overwrite.allow,
                        deny: snapshot.overwrite.deny,
                    });
                } else {
                    await channel.permissionOverwrites.delete(member.id);
                }
            }

            await db.delete(key);

            logger.info(
                `User unblacklisted: ${member.user.tag} by ${moderator.user.tag} in ${guild.name}`,
            );

            return {
                user: member.user.tag,
                userId: member.id,
            };
        } catch (error) {
            logger.error(
                `Error unblacklisting ${member.user?.tag ?? member.id}:`,
                error,
            );

            throw new TitanBotError(
                'Failed to unblacklist user',
                ErrorTypes.DATABASE,
                'I could not completely restore the user permissions. Please try again.',
            );
        }
    }

    static async isBlacklisted(guildId, userId) {
        const data = await db.get(getBlacklistKey(guildId, userId), null);
        return !!data;
    }

    static async getBlacklist(guildId, userId) {
        return db.get(getBlacklistKey(guildId, userId), null);
    }
}

export default BlacklistService;
