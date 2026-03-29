require("dotenv").config();
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const sqlite3 = require("sqlite3").verbose();
const mysql = require("mysql");

const db = new sqlite3.Database("./votes.db");
const staffRoleId = "1474162778645201078";

// Connexion à la BDD FiveM
const fivemDb = mysql.createConnection({
    host: "83.143.117.52",
    user: "u32317_yUZe30DOa4",
    password: "HTAyAcW6UrId7.zL26GHA.Yr",
    database: "s32317_drift"
});

fivemDb.connect((err) => {
    if (err) {
        console.error("❌ Erreur connexion BDD FiveM:", err);
    } else {
        console.log("✅ Connecté à la BDD FiveM");
    }
});

db.run("CREATE TABLE IF NOT EXISTS votes (vehicle_id TEXT, user_id TEXT, note INTEGER, PRIMARY KEY(vehicle_id, user_id))");
db.run("CREATE TABLE IF NOT EXISTS votes_sondage (message_id TEXT, user_id TEXT, reponse TEXT, PRIMARY KEY(message_id, user_id))");
db.run("CREATE TABLE IF NOT EXISTS sondages_questions (message_id TEXT PRIMARY KEY, question TEXT)");
db.run("CREATE TABLE IF NOT EXISTS vehicles (vehicle_id TEXT PRIMARY KEY, name TEXT)");
db.run("CREATE TABLE IF NOT EXISTS maps (map_id TEXT PRIMARY KEY, name TEXT)");
db.run("CREATE TABLE IF NOT EXISTS last_records (race_name TEXT PRIMARY KEY, last_record TEXT)");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Message, Partials.Channel]
});

client.once("ready", async () => {
    console.log(`Bot connecté en tant que ${client.user.tag}`);
    
    // Enregistrer la commande /clean
    const guild = client.guilds.cache.first();
    if (guild) {
        try {
            await guild.commands.create({
                name: "clean",
                description: "Efface un nombre de messages",
                options: [
                    {
                        name: "amount",
                        description: "Nombre de messages à effacer (1-100)",
                        type: 4, // INTEGER
                        required: true
                    }
                ]
            });
            console.log("✅ Commande /clean enregistrée");
        } catch (error) {
            console.error("Erreur lors de l'enregistrement de la commande:", error);
        }
    }
    
    // Vérifier les nouveaux records toutes les 30 secondes
    setInterval(() => {
        fivemDb.query("SELECT NAME, DATA FROM aracing_leaderboards", (err, results) => {
            if (err) {
                console.error("Erreur lecture BDD FiveM:", err);
                return;
            }

            results.forEach(race => {
                const raceName = race.NAME;
                const dataStr = race.DATA;

                try {
                    const data = JSON.parse(dataStr);
                    
                    // Trouver le meilleur record global
                    let bestAuthor = null;
                    let bestTime = null;

                    // Parcourir tous les véhicules (CarHash)
                    for (const [carHash, records] of Object.entries(data)) {
                        if (Array.isArray(records) && records.length > 0) {
                            // Le premier record est le meilleur pour ce véhicule
                            const topRecord = records[0];
                            
                            if (!bestTime || topRecord.Record < bestTime) {
                                bestTime = topRecord.Record;
                                bestAuthor = topRecord.AuthorName;
                            }
                        }
                    }

                    if (bestAuthor) {
                        db.get("SELECT last_record FROM last_records WHERE race_name = ?", [raceName], (err, row) => {
                            // Clé : "NomJoueur|temps" pour tracker qui détient le record ET avec quel temps
                            const recordKey = `${bestAuthor}|${bestTime}`;

                            if (!row || row.last_record !== recordKey) {
                                // Récupérer l'ancien détenteur du record
                                const previousHolder = row ? row.last_record.split("|")[0] : null;

                                // Annoncer UNIQUEMENT si c'est un joueur DIFFÉRENT qui prend le record
                                if (previousHolder !== bestAuthor) {
                                    const recordChannel = client.channels.cache.get("1484931769609486548");
                                    
                                    if (recordChannel) {
                                        recordChannel.send(`🏆 **${bestAuthor}** a battu le record sur **${raceName}** !`);
                                    }
                                }

                                // Mettre à jour la BDD dans tous les cas (même si le même joueur améliore son propre temps)
                                db.run(
                                    "INSERT INTO last_records (race_name, last_record) VALUES (?, ?) ON CONFLICT(race_name) DO UPDATE SET last_record = excluded.last_record",
                                    [raceName, recordKey]
                                );
                            }
                        });
                    }
                } catch (e) {
                    console.error(`Erreur parsing JSON pour ${raceName}:`, e);
                }
            });
        });
    }, 30000); // 30 secondes

    // Envoyer le message de ticket au démarrage
    const ticketChannelId = "1484876204665475135";
    const ticketChannel = client.channels.cache.get(ticketChannelId);
    
    if (ticketChannel) {
        ticketChannel.messages.fetch({ limit: 10 }).then(messages => {
            const ticketMessageExists = messages.some(msg => msg.author.id === client.user.id && msg.content.includes("Si tu rencontres un problème"));
            
            if (!ticketMessageExists) {
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("open_ticket")
                        .setLabel("Ouvre ton ticket")
                        .setStyle(ButtonStyle.Primary)
                );

                ticketChannel.send({
                    content: "Si tu rencontres un problème ou si tu as besoin d'aide, tu peux ouvrir un ticket ici. Un membre du staff te répondra dès que possible 👍\nMerci de bien expliquer ton souci pour qu'on puisse t'aider efficacement !",
                    components: [row]
                });
            }
        });
    }
});

client.on("interactionCreate", async interaction => {
    // Commande /clean pour effacer des messages (STAFF only)
    if (interaction.isCommand() && interaction.commandName === "clean") {
        const staffRoleId = "1474162778645201078";
        
        if (!interaction.member.roles.cache.has(staffRoleId)) {
            return interaction.reply({ content: "❌ Tu dois avoir le rôle **STAFF** pour utiliser cette commande.", ephemeral: true });
        }

        const amount = interaction.options.getInteger("amount");

        if (amount < 1 || amount > 100) {
            return interaction.reply({ content: "❌ Tu dois spécifier un nombre entre 1 et 100.", ephemeral: true });
        }

        try {
            await interaction.channel.bulkDelete(amount);
            await interaction.reply({ content: `✅ ${amount} message(s) supprimé(s) !`, ephemeral: true });
        } catch (error) {
            console.error("Erreur lors de la suppression:", error);
            await interaction.reply({ content: "❌ Erreur lors de la suppression des messages.", ephemeral: true });
        }
    }

    if (interaction.isButton()) {
        // Bouton "Ouvre ton ticket"
        if (interaction.customId === "open_ticket") {
            const userId = interaction.user.id;
            const staffRoleId = "1474162778645201078";
            
            // Créer un salon privé pour le ticket
            const ticketChannel = await interaction.guild.channels.create({
                name: `ticket-${interaction.user.username}`,
                type: 0, // Text channel
                permissionOverwrites: [
                    {
                        id: interaction.guild.id,
                        deny: ["ViewChannel"]
                    },
                    {
                        id: userId,
                        allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"]
                    },
                    {
                        id: staffRoleId,
                        allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"]
                    }
                ]
            });

            // Envoyer un message de bienvenue dans le ticket
            const closeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`close_ticket_${ticketChannel.id}`)
                    .setLabel("Fermer le ticket")
                    .setStyle(ButtonStyle.Danger)
            );

            await ticketChannel.send({
                content: `Bienvenue <@${userId}> ! Un membre du staff va t'aider dès que possible. 👍`,
                components: [closeRow]
            });

            return interaction.reply({ content: `✅ Ton ticket a été créé : ${ticketChannel}`, ephemeral: true });
        }

        // Bouton "Fermer le ticket"
        if (interaction.customId.startsWith("close_ticket_")) {
            const ticketChannelId = interaction.customId.replace("close_ticket_", "");
            const ticketChannel = interaction.guild.channels.cache.get(ticketChannelId);
            const archiveCategoryId = "1484878308440281248";

            if (!ticketChannel) {
                return interaction.reply({ content: "❌ Salon introuvable", ephemeral: true });
            }

            // Déplacer dans la catégorie d'archivage
            await ticketChannel.setParent(archiveCategoryId);
            
            // Mettre en lecture seule
            await ticketChannel.permissionOverwrites.edit(interaction.guild.id, {
                SendMessages: false,
                ViewChannel: true
            });

            // Renommer pour indiquer que c'est fermé
            await ticketChannel.setName(`${ticketChannel.name}-fermé`);

            await interaction.reply({ content: "✅ Le ticket a été fermé et archivé !", ephemeral: true });
        }

        // Bouton "Voter" pour les sondages
        if (interaction.customId.startsWith("vote_button_")) {
            const messageId = interaction.customId.replace("vote_button_", "");

            const menu = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`select_vote_${messageId}`)
                    .setPlaceholder("Choisissez votre réponse")
                    .addOptions([
                        { label: "Oui", value: "oui", emoji: "✅" },
                        { label: "Non", value: "non", emoji: "❌" },
                        { label: "Ne sais pas", value: "ne_sais_pas", emoji: "❓" }
                    ])
            );

            return interaction.reply({ content: "🗳️ Choisissez votre réponse :", components: [menu], ephemeral: true });
        }

        const id = interaction.customId.replace("rate_", "").replace("ratemap_", "");
        const isMap = interaction.customId.startsWith("ratemap_");

        const menu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`${isMap ? "selectmap_" : "select_"}${id}`)
                .setPlaceholder("Choisis une note sur 10")
                .addOptions([...Array(10)].map((_, i) => ({
                    label: `${i + 1}/10`,
                    value: `${i + 1}`
                })))
        );

        return interaction.reply({ content: "Choisis ta note :", components: [menu], ephemeral: true });
    }

    if (interaction.isStringSelectMenu()) {
        // Gestion des votes Oui/Non/Ne sais pas
        if (interaction.customId.startsWith("select_vote_")) {
            const messageId = interaction.customId.replace("select_vote_", "");
            const reponse = interaction.values[0];
            const userId = interaction.user.id;

            // Vérifier si l'utilisateur a déjà voté (sauf s'il est STAFF)
            db.get("SELECT * FROM votes_sondage WHERE message_id = ? AND user_id = ?", [messageId, userId], (err, row) => {
                if (row && !interaction.member.roles.cache.has(staffRoleId)) {
                    return interaction.reply({ content: "⚠️ Tu as déjà voté ! Tu ne peux voter qu'une seule fois.", ephemeral: true });
                }

                db.run(
                    "INSERT INTO votes_sondage (message_id, user_id, reponse) VALUES (?, ?, ?) ON CONFLICT(message_id, user_id) DO UPDATE SET reponse = excluded.reponse",
                    [messageId, userId, reponse],
                    async (err) => {
                        if (err) {
                            console.error(err);
                            return interaction.reply({ content: "❌ Erreur lors de l'enregistrement du vote.", ephemeral: true });
                        }

                        db.get(
                            "SELECT SUM(CASE WHEN reponse = 'oui' THEN 1 ELSE 0 END) AS oui, SUM(CASE WHEN reponse = 'non' THEN 1 ELSE 0 END) AS non, SUM(CASE WHEN reponse = 'ne_sais_pas' THEN 1 ELSE 0 END) AS ne_sais_pas FROM votes_sondage WHERE message_id = ?",
                            [messageId],
                            async (err, row) => {
                                if (err) {
                                    console.error(err);
                                    return interaction.reply({ content: "❌ Erreur lors de la mise à jour.", ephemeral: true });
                                }

                                const oui = row.oui || 0;
                                const non = row.non || 0;
                                const neSaisPas = row.ne_sais_pas || 0;
                                const total = oui + non + neSaisPas;

                                try {
                                    const msg = await interaction.channel.messages.fetch(messageId);
                                    
                                    db.get("SELECT question FROM sondages_questions WHERE message_id = ?", [messageId], async (err, row) => {
                                        if (err) {
                                            console.error(err);
                                            return await interaction.reply({ content: "❌ Erreur lors de la récupération de la question.", ephemeral: true });
                                        }

                                        const question = row ? row.question : "Sondage";
                                        const contenuMaj = `📊 **Sondage**\n${question}\n\n✅ Oui : ${oui} votes\n❌ Non : ${non} votes\n❓ Ne sais pas : ${neSaisPas} votes\n\nTotal : ${total} votes`;

                                        await msg.edit({ content: contenuMaj });
                                        await interaction.reply({ content: "✅ Votre vote a été enregistré !", ephemeral: true });
                                    });
                                } catch (error) {
                                    console.error(error);
                                    await interaction.reply({ content: "❌ Erreur lors de la mise à jour du message.", ephemeral: true });
                                }
                            }
                        );
                    }
                );
            });

            return;
        }

        const isMap = interaction.customId.startsWith("selectmap_");
        const vehicleId = interaction.customId.replace("selectmap_", "").replace("select_", "");
        const note = parseInt(interaction.values[0]);
        const userId = interaction.user.id;

        // Vérifier si l'utilisateur a déjà voté (sauf s'il est STAFF)
        db.get("SELECT * FROM votes WHERE vehicle_id = ? AND user_id = ?", [vehicleId, userId], (err, row) => {
            if (row && !interaction.member.roles.cache.has(staffRoleId)) {
                return interaction.reply({ content: "⚠️ Tu as déjà noté ce véhicule/parcours ! Tu ne peux voter qu'une seule fois.", ephemeral: true });
            }

            db.run(
                "INSERT INTO votes (vehicle_id, user_id, note) VALUES (?, ?, ?) ON CONFLICT(vehicle_id, user_id) DO UPDATE SET note = excluded.note",
                [vehicleId, userId, note]
            );

            db.get("SELECT AVG(note) AS avg, COUNT(*) AS total FROM votes WHERE vehicle_id = ?", [vehicleId], async (err, row) => {
                const avg = row.avg.toFixed(1);
                const total = row.total;

                const msg = await interaction.channel.messages.fetch(vehicleId);
                const lignes = msg.content.split('\n');
                lignes[0] = `⭐ Moyenne : **${avg}/10** (${total} votes)`;
                await msg.edit({ content: lignes.join('\n') });

                interaction.reply({ content: "Ta note a été enregistrée !", ephemeral: true });
            });
        });
    }
});

client.on("guildMemberAdd", async member => {
    const memberRoleId = "1484238651151089807"; // Rôle @Membre
    const role = member.guild.roles.cache.get(memberRoleId);

    if (!role) {
        console.error(`Rôle ${memberRoleId} introuvable`);
        return;
    }

    try {
        await member.roles.add(role);
        console.log(`✅ Rôle @Membre donné à ${member.user.username}`);
    } catch (error) {
        console.error(`Erreur lors de l'ajout du rôle à ${member.user.username}:`, error);
    }
});

client.on("guildMemberRemove", async member => {
    const logChannelId = "1484837398046183575";
    const channel = member.guild.channels.cache.get(logChannelId);

    if (!channel) {
        return;
    }

    try {
        await channel.send(`❌ **${member.user.username}** a quitté le serveur`);
    } catch (error) {
        console.error("Erreur lors de l'envoi du message:", error);
    }
});

client.on("messageCreate", async message => {
    if (message.author.bot) return;

    // Commande !addcar "Nom du véhicule" + image jointe (STAFF only)
    if (message.content.startsWith("!addcar")) {
        if (!message.member.roles.cache.has(staffRoleId)) {
            return message.reply("❌ Tu dois avoir le rôle **STAFF** pour utiliser cette commande.");
        }

        const nom = message.content.slice(8).trim();

        if (!nom) {
            return message.reply("❌ Utilisation : `!addcar Nom du véhicule` avec une image en pièce jointe.");
        }

        if (message.attachments.size === 0) {
            return message.reply("❌ Tu dois joindre une image de la voiture !");
        }

        const image = message.attachments.first();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`rate_PLACEHOLDER`)
                .setLabel("Noter ce véhicule")
                .setStyle(ButtonStyle.Primary)
        );

        const carMessage = await message.channel.send({
            content: `⭐ Moyenne : **-/10** (0 votes)\n🚗 **${nom}**`,
            files: [image.url],
            components: [row]
        });

        const updatedRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`rate_${carMessage.id}`)
                .setLabel("Noter ce véhicule")
                .setStyle(ButtonStyle.Primary)
        );

        await carMessage.edit({ components: [updatedRow] });
        await message.delete();
        
        db.run("INSERT INTO vehicles (vehicle_id, name) VALUES (?, ?)", [carMessage.id, nom]);
    }

    // Commande !addmap "Nom du parcours" + image jointe (STAFF only)
    if (message.content.startsWith("!addmap")) {
        if (!message.member.roles.cache.has(staffRoleId)) {
            return message.reply("❌ Tu dois avoir le rôle **STAFF** pour utiliser cette commande.");
        }

        const nom = message.content.slice(8).trim();

        if (!nom) {
            return message.reply("❌ Utilisation : `!addmap Nom du parcours` avec une image en pièce jointe.");
        }

        if (message.attachments.size === 0) {
            return message.reply("❌ Tu dois joindre une image du parcours !");
        }

        const image = message.attachments.first();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ratemap_PLACEHOLDER`)
                .setLabel("Noter ce parcours")
                .setStyle(ButtonStyle.Success)
        );

        const mapMessage = await message.channel.send({
            content: `⭐ Moyenne : **-/10** (0 votes)\n🗺️ **${nom}**`,
            files: [image.url],
            components: [row]
        });

        const updatedRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ratemap_${mapMessage.id}`)
                .setLabel("Noter ce parcours")
                .setStyle(ButtonStyle.Success)
        );

        await mapMessage.edit({ components: [updatedRow] });
        await message.delete();
        
        db.run("INSERT INTO maps (map_id, name) VALUES (?, ?)", [mapMessage.id, nom]);
    }

    // Commande !addvote (STAFF only)
    if (message.content.startsWith("!addvote")) {
        if (!message.member.roles.cache.has(staffRoleId)) {
            return message.reply("❌ Tu dois avoir le rôle **STAFF** pour utiliser cette commande.");
        }

        const question = message.content.slice(9).trim();

        if (!question) {
            return message.reply("❌ Utilisation : `!addvote Votre question ici`");
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`vote_button_PLACEHOLDER`)
                .setLabel("Votez")
                .setStyle(ButtonStyle.Primary)
        );

        const voteMessage = await message.channel.send({
            content: `📊 **Sondage**\n${question}\n\n✅ Oui : 0 votes\n❌ Non : 0 votes\n❓ Ne sais pas : 0 votes\n\nTotal : 0 votes`,
            components: [row]
        });

        const updatedRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`vote_button_${voteMessage.id}`)
                .setLabel("Votez")
                .setStyle(ButtonStyle.Primary)
        );

        await voteMessage.edit({ components: [updatedRow] });
        
        db.run("INSERT INTO sondages_questions (message_id, question) VALUES (?, ?)", [voteMessage.id, question]);
        
        await message.delete();
    }

    // Commande !topcar (accessible à tous)
    if (message.content === "!topcar") {
        db.all(
            "SELECT votes.vehicle_id, AVG(votes.note) AS moyenne, COUNT(votes.user_id) AS votes_count, vehicles.name FROM votes LEFT JOIN vehicles ON votes.vehicle_id = vehicles.vehicle_id GROUP BY votes.vehicle_id ORDER BY moyenne DESC LIMIT 10",
            async (err, rows) => {
                if (err) {
                    console.error(err);
                    return message.reply("❌ Erreur lors de la récupération du classement.");
                }

                if (!rows || rows.length === 0) {
                    return message.reply("❌ Aucun véhicule noté pour le moment.");
                }

                let topMessage = "🏆 **TOP 10 DES MEILLEURS VÉHICULES** 🏆\n\n";

                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    const vehicleName = row.name || `Véhicule ${row.vehicle_id}`;
                    const moyenne = row.moyenne.toFixed(1);
                    const votes = row.votes_count;

                    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
                    topMessage += `${medal} **${vehicleName}** - ⭐ ${moyenne}/10 (${votes} vote${votes > 1 ? 's' : ''})\n`;
                }

                topMessage += "\n📊 **Classement basé sur la moyenne des notes**";

                message.reply(topMessage);
            }
        );
    }

    // Commande !topmap (accessible à tous)
    if (message.content === "!topmap") {
        db.all(
            "SELECT votes.vehicle_id, AVG(votes.note) AS moyenne, COUNT(votes.user_id) AS votes_count, maps.name FROM votes LEFT JOIN maps ON votes.vehicle_id = maps.map_id GROUP BY votes.vehicle_id ORDER BY moyenne DESC LIMIT 10",
            async (err, rows) => {
                if (err) {
                    console.error(err);
                    return message.reply("❌ Erreur lors de la récupération du classement.");
                }

                if (!rows || rows.length === 0) {
                    return message.reply("❌ Aucune map notée pour le moment.");
                }

                let topMessage = "🏆 **TOP 10 DES MEILLEURES MAPS** 🏆\n\n";

                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    const mapName = row.name || `Map ${row.vehicle_id}`;
                    const moyenne = row.moyenne.toFixed(1);
                    const votes = row.votes_count;

                    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
                    topMessage += `${medal} **${mapName}** - ⭐ ${moyenne}/10 (${votes} vote${votes > 1 ? 's' : ''})\n`;
                }

                topMessage += "\n📊 **Classement basé sur la moyenne des notes**";

                message.reply(topMessage);
            }
        );
    }
});

client.login(process.env.TOKEN);
