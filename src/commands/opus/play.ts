import { ActionRowBuilder, ApplicationCommandOptionType, GuildMember, MessageActionRowComponentBuilder, PermissionFlagsBits, SelectMenuBuilder, SelectMenuInteraction, SelectMenuOptionBuilder } from "discord.js";
import ytdl from "ytdl-core";
import ytpl from "ytpl";
import ytsr from "ytsr";
import { ExtendedClient } from "../../structures/Client";
import { Command, COMMANDS, COMMAND_TAGS } from "../../structures/Command";
import { OpusPlayer } from "../../structures/opus/Player";
import { Track } from "../../structures/opus/Track";
import { baseEmbed, formatDuration, generateInteractionComponentId } from "../../structures/Utils";
import { ExecuteOptions } from "../../typings/command";

export enum PLAY_OPTIONS{
    query = 'query',
    next = 'next',
    queue = 'queue',
    track_select = 'track_select'
}

export default new Command({
    name: COMMANDS.play,
    tag: COMMAND_TAGS.music,
    description: 'Enqueue/Insert a Youtube track/playlist/search result from the given url or query',
    userPermissions: [PermissionFlagsBits.SendMessages],

    options: [
    {
        type: ApplicationCommandOptionType.Subcommand,
        name: PLAY_OPTIONS.queue,
        description: 'Enqueue a Youtube track/playlist/search result from the given url or query',
        options: [{
            type: ApplicationCommandOptionType.String,
            name: PLAY_OPTIONS.query,
            description: 'Please provide an url or query for playback',
            required: true,
        }],
    },
    {
        type: ApplicationCommandOptionType.Subcommand,
        name: PLAY_OPTIONS.next,
        description: 'Insert to next a Youtube track/playlist/search result from the given url or query',
        options: [{
            type: ApplicationCommandOptionType.String,
            name: PLAY_OPTIONS.query,
            description: 'Please provide an url or query for playback',
            required: true,
        }],
    },
    ],
    
    execute: async({ client, interaction, args }) => {
        const mPlayer = client.music.get(interaction.guildId) || new OpusPlayer({ client, interaction, args });

        let result: Track[];

        if(args.getSubcommand() == PLAY_OPTIONS.next){
            result = await processQuery({ client, interaction, args }, 'inserted');
            mPlayer.queue.splice(1, 0, ...result);
        }
        else if(args.getSubcommand() == PLAY_OPTIONS.queue){
            result = await processQuery({ client, interaction, args }, 'enqueued');
            mPlayer.queue.push(...result);
        }

        mPlayer.playIfIdling(client);
    }
});

async function processQuery({ client, interaction, args }: ExecuteOptions, subCommand: string){
    const { member } = interaction;
    const memberName = member.nickname || member.user.username;
    const query = args.get(PLAY_OPTIONS.query).value as string;
    let result: Track[] = [];

    // if the given queuery is a url
    if(query.startsWith("https://")){
        // if the queury is a youtube video link
        if(ytdl.validateURL(query)) {  
            await ytdl.getBasicInfo(query).then(async trackInfo => {
                //console.log(trackInfo);
                const { videoId, title, lengthSeconds } = trackInfo.player_response.videoDetails;
                const track = new Track(videoId, trackInfo.videoDetails.video_url, title, Number(lengthSeconds)*1000, member);
                result.push(track);

                interaction.followUp({ content: client.replyMsgAuthor(member, `${client.user.username} has ${subCommand}`), embeds: [track.createEmbedThumbnail()] });
            }).catch(err => { interaction.followUp({ content: `${err}` }) });
        }
        // if the queury is a youtube playlist link
        else if (ytpl.validateID(query)){
            // limit can be Infinity
            await ytpl(query, { limit: 1000 }).then(async playlist =>{
                // console.log(playlist);

                let playListDuration = 0;
        
                playlist.items.forEach(async track => {
                    //console.log(trackInfo);
                    if(track.durationSec){
                        const trackDuration = track.durationSec * 1000;
                        result.push(new Track(track.id, track.url, track.title, trackDuration, member));
                        playListDuration += trackDuration;
                    }
                });

                const embed = baseEmbed()
                    .setTitle(`Playlist`)
                    .setDescription(`[${playlist.title}](${playlist.url})`)
                    .setImage(playlist.bestThumbnail.url)
                    .addFields(
                        { name: 'Requested By', value: `${memberName}-sama`, inline: true },
                        { name: 'Lenght', value: `${formatDuration(playListDuration)}`, inline: true },
                        { name: 'Size', value: `${result.length}`, inline: true },
                    );

                interaction.followUp({ content: client.replyMsgAuthor(interaction.member, `${client.user.username} has ${subCommand}`), embeds: [embed] });
            }).catch(err => { interaction.followUp({ content: `${err}` }) });
        }
    } // end of url
    // else try searching youtube with the given argument
    else{
        await ytsr(query, { limit:7 }).then(async results => {
            const tracks = results.items.filter(i => i.type == "video") as ytsr.Video[];

            if(tracks.length === 0) {
                interaction.followUp({ content: client.replyMsgErrorAuthor(interaction.member, `${client.user.username} couldn't find any tracks with the given keywords`) });
                return; 
            }

            // embed the result(s)
            let i = 0;
            let tracksInfo = '';
            let menuOptBuilder: SelectMenuOptionBuilder[] = [new SelectMenuOptionBuilder({ label: 'Dismiss', description: 'Dismiss the current results', value: '0' })];

            tracks.forEach( async (track) => {
                tracksInfo += `${++i}) [${track.title}](${track.url}) | length \`${track.duration}\` \n\n`;
                menuOptBuilder.push(new SelectMenuOptionBuilder({ label: `Track ${i}`, description: `${track.title}`, value: `${track.url}` }));
            })

            const embed = baseEmbed()
                .setTitle(`Search results ヽ (o´∀\`) ﾉ ♪ ♬`)
                .setDescription(tracksInfo)
                .setImage("https://c.tenor.com/pnXpZl3VRiwAAAAC/minato-aqua-akutan.gif");

            const actionRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
                .addComponents(
                    new SelectMenuBuilder()
                        .setCustomId(generateInteractionComponentId(PLAY_OPTIONS.track_select, member.id))
                        .setPlaceholder(`${memberName}-sama, please select an option`)
                        .addOptions(menuOptBuilder)
                );

            handleSelectTrackInteraction = args.getSubcommand() == PLAY_OPTIONS.next ? selectTrackInsert :  selectTrackPush;

            interaction.followUp({ content: `**${memberName}**-sama`, embeds: [embed], components: [actionRow] });
        }).catch(err => { interaction.followUp({ content: `${err}` }) });
    } // end of else the given is keyword

    return result;
}

async function createTrack(url: string, author: GuildMember){
    const trackInfo = await ytdl.getBasicInfo(url);
    const { videoId, title, lengthSeconds } = trackInfo.player_response.videoDetails;
    return new Track(videoId, trackInfo.videoDetails.video_url, title, Number(lengthSeconds)*1000, author);
}

interface IHandlingSelectTrackInteractionDelegate{
    (client: ExtendedClient, interaction: SelectMenuInteraction) : void;
}

export let handleSelectTrackInteraction : IHandlingSelectTrackInteractionDelegate;

async function selectTrackPush(client: ExtendedClient, interaction: SelectMenuInteraction) {
    try{
        const member = interaction.member as GuildMember;
        const mPlayer = client.music.get(interaction.guildId);
        
        if(!mPlayer) { 
            throw new Error('Outdated session');
        }

        const track = await createTrack(interaction.values[0], member);

        mPlayer.queue.push(track);
        interaction.message.edit({ content: `${client.replyMsgAuthor(member, `${client.user.username} has enqueued`)}`, embeds: [track.createEmbedThumbnail()], components: [] });

        mPlayer.playIfIdling(client);
    }
    catch(err){
        interaction.message.delete();
        interaction.deleteReply();
    }
}

async function selectTrackInsert(client: ExtendedClient, interaction: SelectMenuInteraction) {
    try{
        const member = interaction.member as GuildMember;
        const mPlayer = client.music.get(interaction.guildId);

        if(!mPlayer) { 
            throw new Error('Outdated session');
        }

        const track = await createTrack(interaction.values[0], member);

        mPlayer.queue.splice(1, 0, track);
        interaction.message.edit({ content: `${client.replyMsgAuthor(member, `${client.user.username} has inserted`)}`, embeds: [track.createEmbedThumbnail()], components: [] });

        mPlayer.playIfIdling(client);
    }
    catch(err){
        interaction.message.delete();
        interaction.deleteReply();
    }
}