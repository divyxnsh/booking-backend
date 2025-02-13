import { CommandInteraction, MessageEmbed, MessageActionRow, MessageSelectMenu, MessageButton, SelectMenuInteraction, Message, TextChannel } from 'discord.js';
import RoomModel, { Room } from '../../models/room.model';
import SectionModel, { Section } from '../../models/section.model';
import TimeBlockModel from '../../models/timeBlock.model';
import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import manageCommand from './manage';

interface TimeblockInformation {
    startsAt: DateTime;
    endsAt: DateTime;
    availableCapacity: number;
}

interface SectionInformation extends Section {
    _id?: Types.ObjectId;
}

function dateSuffix(day: number) {
    if (day > 3 && day < 21) return 'th';
    switch (day % 10) {
        case 1:
            return 'st';
        case 2:
            return 'nd';
        case 3:
            return 'rd';
        default:
            return 'th';
    }
}

function getDateOptions(selectedDate?: string) {
    const dateOptions = [];
    let currentDate = DateTime.now().setZone('America/Toronto');

    for (let i = 0; i < 14; i++) {
        dateOptions.push({
            label: `${currentDate.weekdayLong} - ${currentDate.monthLong} ${currentDate.day}${dateSuffix(currentDate.day)}`,
            value: currentDate.toISODate(),
            default: currentDate.toISODate() === selectedDate,
        });
        currentDate = currentDate.plus({ days: 1 });
    }
    return dateOptions;
}

async function parseCommandOptions(interaction: CommandInteraction): Promise<string[] | undefined> {
    //Parses the book command option parameters to return the corresponding Room's section ID
    const roomName = interaction.options.getString('room-name');
    const roomJson = await RoomModel.findOne({ name: roomName !== null ? roomName : undefined });

    if (!roomJson) {
        interaction.reply({ content: 'Invalid Room: Do `/rooms` to see all avaliable rooms!', ephemeral: true });
        return undefined;
    }

    const sectionJson = await SectionModel.find({ roomId: roomJson._id });
    const specificSection = sectionJson.find((s) => s.name === interaction.options.getString('section-name'));

    if (!specificSection) {
        interaction.reply({ content: 'Invalid Section: Do `/rooms` to see all avaliable rooms and sections!', ephemeral: true });
        return undefined;
    }

    return [roomJson._id, specificSection._id];
}

async function searchTimeblocks(selectedDate: string, sectionInformation: SectionInformation, roomInformation: Room): Promise<TimeblockInformation[]> {
    //Function finds all available timeblocks for a given date

    const currentDate = DateTime.now().setZone('America/Toronto');
    const nextHour = currentDate.toISODate() === selectedDate ? currentDate.hour : 0;

    const startDate = DateTime.fromISO(selectedDate, { zone: 'America/Toronto' }).set({ hour: nextHour });
    const endDate = DateTime.fromISO(selectedDate, { zone: 'America/Toronto' }).set({ hour: 23 });

    const bookedTimeblocks = await TimeBlockModel.find({
        sectionId: sectionInformation._id,
        startsAt: { $gte: startDate.toJSDate() },
    });

    const timeBlocks = [];
    let currHourStart = startDate;
    let currHourEnd = currHourStart.plus({ hours: 1 });

    // Iterate through the hours in the given time range
    while (currHourStart < endDate) {
        // Finds schedule start and end for the day that the current hour falls on and assigns the appropriate hours for scheduleDayStart and scheduleDayEnd
        const { start: scheduleDayStart, end: scheduleDayEnd } = roomInformation.schedule.find((day) => day.dayOfWeek + 1 === currHourStart.weekday) ?? { start: 0, end: 0 };

        // Checks if the hour falls under an open time for the room and if it does adds hour to the list of available times
        if (!roomInformation.closed && currHourStart.weekday === currHourEnd.weekday && currHourStart.hour >= scheduleDayStart && currHourEnd.hour <= scheduleDayEnd) {
            // Check for time block in database
            const bookedTimeBlockFound = bookedTimeblocks.find((bookedTimeBlock) => bookedTimeBlock.startsAt.getTime() === currHourStart.toMillis());

            if (!bookedTimeBlockFound) {
                const newTimeBlock = {
                    startsAt: currHourStart,
                    endsAt: currHourEnd,
                    availableCapacity: sectionInformation.capacity,
                };
                timeBlocks.push(newTimeBlock);
            }
        }

        // Increments hour start and end for next iteration
        currHourStart = currHourStart.plus({ hours: 1 });
        currHourEnd = currHourEnd.plus({ hours: 1 });
    }
    return timeBlocks;
}

function timeConversion(timeObject: DateTime) {
    //Converts 24 hour time to 12 hour time with a.m. and p.m. and changes 0:00 to 12:00
    return timeObject.setZone('America/Toronto').toFormat('h:mm a');
}

function parseTimeblocks(timeBlocks: TimeblockInformation[]) {
    //Sets up select menu options for timeblocks
    const timeBlockOptions = [];
    for (const timeBlock of timeBlocks) {
        timeBlockOptions.push({
            label: `${timeConversion(timeBlock.startsAt)} - ${timeConversion(timeBlock.endsAt)}`,
            description: `Section Capacity: ${timeBlock.availableCapacity}`,
            value: `‎${timeBlock.startsAt.hour},‎${timeBlock.endsAt.hour},${timeBlock.availableCapacity}`,
        });
    }

    if (timeBlockOptions.length === 0) {
        return new MessageButton().setCustomId('unavailable').setLabel('No currently avaliable timeblocks on selected date').setStyle('DANGER').setDisabled(true);
    }
    return new MessageSelectMenu().setCustomId('timeBlockSelectMenu').setPlaceholder('Select a Time to Book!').addOptions(timeBlockOptions);
}

export default {
    name: 'manualbook',
    description: 'Know the exact room and section you want to book? Use this command to immediately book it!',
    options: [
        {
            type: 3,
            name: 'room-name',
            description: 'Name of Room to Book',
            required: true,
        },
        {
            type: 3,
            name: 'section-name',
            description: 'Name of Section to Book',
            required: true,
        },
    ],
    enabled: false,

    async execute(interaction: CommandInteraction | SelectMenuInteraction, _roomId?: string, _sectionId?: string): Promise<void> {
        if (interaction.isCommand()) {
            await parseCommandOptions(interaction).then((response) => {
                if (response === undefined) return;
                _roomId = response[0];
                _sectionId = response[1];
            });
        }

        if (_roomId === undefined || _sectionId === undefined) return;

        const roomInformation = await RoomModel.findOne({ _id: Types.ObjectId(_roomId) });
        const sectionInformation = await SectionModel.findOne({ _id: Types.ObjectId(_sectionId) });

        const embed = new MessageEmbed()
            .setColor('#48d7fb')
            .setTitle('Date and Time')
            .setDescription('Choose the date and time of your booking.ㅤㅤㅤ ㅤ ㅤ ㅤㅤㅤ\n ')
            .setFooter(`Currently Booking: ${roomInformation!.name} - ${sectionInformation!.name}`);

        let selectMenuDate = new MessageActionRow().addComponents(new MessageSelectMenu().setCustomId('dateSelectMenu').setPlaceholder('Select Date of Room Booking').addOptions(getDateOptions()));
        let menuSelectedDate: string;

        const message = (await interaction.reply({ content: `${interaction.user}`, embeds: [embed], components: [selectMenuDate], fetchReply: true })) as Message;
        let promptCompleted = false;
        const selectMenuCollector = message.createMessageComponentCollector({ componentType: 'SELECT_MENU', time: 600000 });

        selectMenuCollector.on('collect', async (menuInteraction: SelectMenuInteraction) => {
            //Temporary check as message isn't ephemeral
            if (menuInteraction.user.id === interaction.user.id) {
                switch (menuInteraction.customId) {
                    case 'dateSelectMenu': {
                        menuSelectedDate = menuInteraction.values[0];
                        selectMenuDate = new MessageActionRow().addComponents(
                            new MessageSelectMenu().setCustomId('dateSelectMenu').setPlaceholder('Select Date of Room Booking').addOptions(getDateOptions(menuSelectedDate))
                        );
                        const availableTimeblocks = new MessageActionRow().addComponents(parseTimeblocks(await searchTimeblocks(menuSelectedDate, sectionInformation!, roomInformation!)));

                        menuInteraction.update({ components: [selectMenuDate, availableTimeblocks] });
                        break;
                    }
                    case 'timeBlockSelectMenu': {
                        //ESLint disabled for next line as regex is correct at removing unicode characters. Removes hidden unicode U+200E character that invalidates parseInt()/toJSDate()
                        const selectedTimeblock = menuInteraction.values[0].split(',').map((element: string) => element.replace(/[^\x00-\x7F]/g, '')); //eslint-disable-line

                        const selectedDate = DateTime.fromFormat(menuSelectedDate, 'yyyy-MM-dd', { zone: 'America/Toronto' });
                        const _startsAt = selectedDate.set({ hour: parseInt(selectedTimeblock[0]) }).toJSDate();
                        const maxCapacity = parseInt(selectedTimeblock[2]);

                        const existingTimeBlock = await TimeBlockModel.findOne({ sectionId: Types.ObjectId(_sectionId), startsAt: _startsAt });
                        if (existingTimeBlock) {
                            await menuInteraction.reply({
                                embeds: [new MessageEmbed().setColor('RED').setDescription('Error: This timeblock was booked while you were browsing. Please select a different time.')],
                                ephemeral: true,
                            });
                            break;
                        }

                        const timeBlock = await TimeBlockModel.create({
                            users: [interaction.user.id],
                            booker: interaction.user.id,
                            sectionId: Types.ObjectId(_sectionId),
                            startsAt: _startsAt,
                        });

                        console.log(`${interaction.user.tag} created booking with id ${timeBlock._id}.`);

                        promptCompleted = true;
                        selectMenuCollector.stop();
                        await interaction.deleteReply();
                        await manageCommand.handleSelectMenu(menuInteraction, [interaction.user.id], maxCapacity, timeBlock._id);
                        break;
                    }
                    default:
                        console.log('Selected Menu Not Found!');
                }
            } else {
                menuInteraction.reply({ content: "This select menu isn't for you!", ephemeral: true });
            }
        });

        selectMenuCollector.on('end', async () => {
            if (!promptCompleted) {
                if (message.channel && (message.channel as TextChannel).name.startsWith(`book-`) && message.channel instanceof TextChannel) {
                    await message.channel.delete();
                }
            }
        });
    },
};
