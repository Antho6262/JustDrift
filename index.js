require("dotenv").config();
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const sqlite3 = require("sqlite3").verbose();
const mysql = require("mysql");
const http = require("http");

const db = new sqlite3.Database("./votes.db");
const staffRoleId = "1474162778645201078";
const DUEL_CHANNEL_ID = "1488939134134521897";
const STATUS_CHANNEL_ID = "1488090872548556801";

// Maps drift uniquement pour les duels
const DRIFT_MAPS = [
    "CANYON DRIFT", "CARBON DRIFT", "CARBON TANDEM", "CATALOGNE DRIFT",
    "DOWNHILL DRIFT", "DRIFTPARK DRIFT", "DRIFTSCHOOL DRIFT", "EAST VALLEY DRIFT",
    "EBISU KITA DRIFT", "KAMI ROAD DRIFT", "MAPLE VALLEY DRIFT", "NFS CARBON",
    "NORDSCHLEIFE", "NURBGP DRIFT", "OBSERVATOIREV1 DRIFT", "PETROL HILL DRIFT",
    "SPEEDWAY DRIFT", "USUI DRIFT", "VINEWOOD DRIFT"
];

let isFirstRun = true;

// ── Connexion MySQL avec reconnexion automatique ──
let fivemDb;

function createMysqlConnection() {
    fivemDb = mysql.createConnection({
        host: "83.143.117.52",
        user: "u32317_yUZe30DOa4",
        password: "HTAyAcW6UrId7.zL26GHA.Yr",
        database: "s32317_drift"
    });

    fivemDb.connect((err) => {
        if (err) {
            console.error("❌ Erreur connexion BDD FiveM:", err);
            setTimeout(createMysqlConnection, 5000);
        } else {
            console.log("✅ Connecté à la BDD FiveM");
        }
    });

    fivemDb.on("error", (err) => {
        console.error("Erreur MySQL:", err.message);
        if (err.code === "PROTOCOL_CONNECTION_LOST" || err.code === "ECONNRESET" || err.code === "ETIMEDOUT") {
            console.log("🔄 Reconnexion MySQL...");
            createMysqlConnection();
        }
    });
}

createMysqlConnection();

function queryDb(sql, params = []) {
    return new Promise((resolve, reject) => {
        fivemDb.query(sql, params, (err, results) => {
            if (err) return reject(err);
            resolve(results);
        });
    });
}

db.run("CREATE TABLE IF NOT EXISTS votes (vehicle_id TEXT, user_id TEXT, note INTEGER, PRIMARY KEY(vehicle_id, user_id))");
db.run("CREATE TABLE IF NOT EXISTS votes_sondage (message_id TEXT, user_id TEXT, reponse TEXT, PRIMARY KEY(message_id, user_id))");
db.run("CREATE TABLE IF NOT EXISTS sondages_questions (message_id TEXT PRIMARY KEY, question TEXT)");
db.run("CREATE TABLE IF NOT EXISTS vehicles (vehicle_id TEXT PRIMARY KEY, name TEXT)");
db.run("CREATE TABLE IF NOT EXISTS maps (map_id TEXT PRIMARY KEY, name TEXT)");
db.run("CREATE TABLE IF NOT EXISTS last_records (race_name TEXT PRIMARY KEY, last_record TEXT)");
db.run("CREATE TABLE IF NOT EXISTS status_message (id INTEGER PRIMARY KEY, message_id TEXT)");
db.run(`CREATE TABLE IF NOT EXISTS duels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    challenger_id TEXT,
    challenged_id TEXT,
    challenger_ig TEXT,
    challenged_ig TEXT,
    map_name TEXT,
    challenger_done INTEGER DEFAULT 0,
    challenged_done INTEGER DEFAULT 0,
    message_id TEXT,
    status TEXT DEFAULT 'waiting'
)`);

process.on("unhandledRejection", (error) => {
    console.error("Erreur non gérée:", error?.message || error);
});

// Récupérer le meilleur score de drift d'un joueur sur une map (le plus grand Record gagne)
async function getPlayerBestScore(playerName, mapName) {
    try {
        const results = await queryDb("SELECT DATA FROM aracing_leaderboards WHERE NAME = ?", [mapName]);
        if (!results || results.length === 0) return null;
        const data = JSON.parse(results[0].DATA);
        let bestScore = null;
        for (const [carHash, records] of Object.entries(data)) {
            if (Array.isArray(records)) {
                const playerRecord = records.find(r => r.AuthorName && r.AuthorName.toLowerCase() === playerName.toLowerCase());
                if (playerRecord && (!bestScore || playerRecord.Record > bestScore)) {
                    bestScore = playerRecord.Record;
                }
            }
        }
        return bestScore;
    } catch { return null; }
}

function formatScore(score) {
    if (!score) return "Aucun score";
    return `${Math.round(score).toLocaleString()} pts`;
}

function getFiveMServerInfo() {
    return new Promise((resolve) => {
        http.get("http://83.143.117.52:30120/info.json", (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
        }).on("error", () => resolve(null));
    });
}

function getFiveMPlayers() {
    return new Promise((resolve) => {
        http.get("http://83.143.117.52:30120/players.json", (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
        }).on("error", () => resolve(null));
    });
}

async function updateServerStatus(client) {
    try {
        const statusChannel = client.channels.cache.get(STATUS_CHANNEL_ID);
        if (!statusChannel) return;

        const [info, players] = await Promise.all([getFiveMServerInfo(), getFiveMPlayers()]);
        const isOnline = info !== null && players !== null;
        const playerCount = players ? players.length : 0;
        const maxPlayers = info ? (info.vars?.sv_maxClients || 32) : 32;

        const barLength = 20;
        const filled = Math.round((playerCount / maxPlayers) * barLength);
        const bar = "█".repeat(filled) + "░".repeat(barLength - filled);

        const embed = new EmbedBuilder()
            .setColor(isOnline ? 0x00FF7F : 0xFF0000)
            .setTitle("🖥️ Statut du serveur JustDrift")
            .addFields(
                { name: "📡 Statut", value: isOnline ? "🟢 **En ligne**" : "🔴 **Hors ligne**", inline: true },
                { name: "🌐 IP", value: "`83.143.117.52:30120`", inline: true },
                { name: "\u200b", value: "\u200b", inline: true },
                { name: "👥 Joueurs connectés", value: isOnline ? `**${playerCount} / ${maxPlayers}**\n\`[${bar}]\`` : "N/A" }
            )
            .setFooter({ text: "🔄 Dernière mise à jour" })
            .setTimestamp();

        if (isOnline && players && players.length > 0) {
            const playerList = players.slice(0, 10).map(p => `• ${p.name}`).join("\n");
            const extra = players.length > 10 ? `\n*...et ${players.length - 10} autres*` : "";
            embed.addFields({ name: "🏎️ Pilotes sur la piste", value: playerList + extra });
        }

        db.get("SELECT message_id FROM status_message WHERE id = 1", async (err, row) => {
            if (row && row.message_id) {
                try {
                    const msg = await statusChannel.messages.fetch(row.message_id);
                    await msg.edit({ embeds: [embed] });
                } catch {
                    const newMsg = await statusChannel.send({ embeds: [embed] });
                    db.run("INSERT INTO status_message (id, message_id) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET message_id = excluded.message_id", [newMsg.id]);
                }
            } else {
                const newMsg = await statusChannel.send({ embeds: [embed] });
                db.run("INSERT INTO status_message (id, message_id) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET message_id = excluded.message_id", [newMsg.id]);
            }
        });
    } catch (e) { console.error("Erreur updateServerStatus:", e); }
}

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

    const guild = client.guilds.cache.first();
    if (guild) {
        try {
            await guild.commands.create({
                name: "clean",
                description: "Efface un nombre de messages",
                options: [{ name: "amount", description: "Nombre de messages à effacer (1-100)", type: 4, required: true }]
            });
            console.log("✅ Commande /clean enregistrée");
        } catch (e) { console.error("Erreur enregistrement commande:", e); }
    }

    updateServerStatus(client);
    setInterval(() => updateServerStatus(client), 30 * 60 * 1000);

    // ── Vérification records ──
    const checkRecords = () => {
        fivemDb.query("SELECT NAME, DATA FROM aracing_leaderboards", (err, results) => {
            if (err) { console.error("Erreur lecture BDD FiveM:", err); return; }

            let processed = 0;
            const total = results.length;

            if (total === 0) {
                if (isFirstRun) { isFirstRun = false; console.log("✅ Records chargés en silence, les annonces sont maintenant actives."); }
                return;
            }

            const done = () => {
                processed++;
                if (processed === total && isFirstRun) {
                    isFirstRun = false;
                    console.log("✅ Records chargés en silence, les annonces sont maintenant actives.");
                }
            };

            results.forEach(race => {
                const raceName = race.NAME;
                try {
                    const data = JSON.parse(race.DATA);
                    let bestAuthor = null, bestRecord = null;

                    for (const [carHash, records] of Object.entries(data)) {
                        if (Array.isArray(records) && records.length > 0) {
                            const topRecord = records[0];
                            if (bestRecord === null || topRecord.Record < bestRecord) {
                                bestRecord = topRecord.Record;
                                bestAuthor = topRecord.AuthorName;
                            }
                        }
                    }

                    if (bestAuthor) {
                        db.get("SELECT last_record FROM last_records WHERE race_name = ?", [raceName], (err, row) => {
                            const recordKey = `${bestAuthor}|${bestRecord}`;
                            if (!row || row.last_record !== recordKey) {
                                const previousHolder = row ? row.last_record.split("|")[0] : null;
                                if (!isFirstRun && previousHolder !== bestAuthor) {
                                    const recordChannel = client.channels.cache.get("1484931769609486548");
                                    if (recordChannel) {
                                        if (previousHolder) {
                                            recordChannel.send(`🏆 **${bestAuthor}** a battu le record de **${previousHolder}** sur **${raceName}** !`).catch(() => {});
                                        } else {
                                            recordChannel.send(`🏆 **${bestAuthor}** a établi le premier record sur **${raceName}** !`).catch(() => {});
                                        }
                                    }
                                }
                                db.run("INSERT INTO last_records (race_name, last_record) VALUES (?, ?) ON CONFLICT(race_name) DO UPDATE SET last_record = excluded.last_record", [raceName, recordKey]);
                            }
                            done();
                        });
                    } else { done(); }
                } catch (e) { console.error(`Erreur parsing JSON pour ${raceName}:`, e); done(); }
            });
        });
    };

    checkRecords();
    setInterval(checkRecords, 30000);

    const ticketChannel = client.channels.cache.get("1484876204665475135");
    if (ticketChannel) {
        ticketChannel.messages.fetch({ limit: 10 }).then(messages => {
            const exists = messages.some(msg => msg.author.id === client.user.id && msg.content.includes("Si tu rencontres un problème"));
            if (!exists) {
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("open_ticket").setLabel("Ouvre ton ticket").setStyle(ButtonStyle.Primary)
                );
                ticketChannel.send({
                    content: "Si tu rencontres un problème ou si tu as besoin d'aide, tu peux ouvrir un ticket ici. Un membre du staff te répondra dès que possible 👍\nMerci de bien expliquer ton souci pour qu'on puisse t'aider efficacement !",
                    components: [row]
                });
            }
        }).catch(() => {});
    }
});

client.on("guildMemberAdd", async member => {
    const memberRoleId = "1484238651151089807";
    const role = member.guild.roles.cache.get(memberRoleId);
    if (role) {
        try { await member.roles.add(role); console.log(`✅ Rôle @Membre donné à ${member.user.username}`); }
        catch (e) { console.error("Erreur rôle:", e); }
    }
    const welcomeChannel = member.guild.channels.cache.get("1474139529786032201");
    if (welcomeChannel) {
        try {
            const embed = new EmbedBuilder()
                .setColor(0xFF4500)
                .setTitle("🏎️ Nouveau pilote sur la piste !")
                .setDescription(`Bienvenue sur **JustDrift**, <@${member.user.id}> !\n\nPrépare-toi à chauffer les pneus et à drifter comme jamais 🔥\nN'hésite pas à consulter les règles du serveur et à te présenter !`)
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
                .addFields(
                    { name: "👤 Pilote", value: member.user.username, inline: true },
                    { name: "👥 Membre n°", value: `${member.guild.memberCount}`, inline: true }
                )
                .setFooter({ text: "JustDrift • Bienvenue dans la famille !" })
                .setTimestamp();
            await welcomeChannel.send({ embeds: [embed] });
        } catch (e) { console.error("Erreur bienvenue:", e); }
    }
});

client.on("guildMemberRemove", async member => {
    const channel = member.guild.channels.cache.get("1484837398046183575");
    if (!channel) return;
    try { await channel.send(`❌ **${member.user.username}** a quitté le serveur`); }
    catch (e) { console.error("Erreur départ:", e); }
});

client.on("interactionCreate", async interaction => {
    try {
        // ── /clean ──
        if (interaction.isCommand() && interaction.commandName === "clean") {
            if (!interaction.member.roles.cache.has(staffRoleId))
                return await interaction.reply({ content: "❌ Tu dois avoir le rôle **STAFF**.", ephemeral: true });
            const amount = interaction.options.getInteger("amount");
            if (amount < 1 || amount > 100)
                return await interaction.reply({ content: "❌ Nombre entre 1 et 100.", ephemeral: true });
            try {
                await interaction.channel.bulkDelete(amount);
                await interaction.reply({ content: `✅ ${amount} message(s) supprimé(s) !`, ephemeral: true });
            } catch {
                await interaction.reply({ content: "❌ Erreur lors de la suppression.", ephemeral: true }).catch(() => {});
            }
            return;
        }

        // ── MODALS ──
        if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith("modal_accept_duel_")) {
                const duelId = interaction.customId.replace("modal_accept_duel_", "");
                const challengedIg = interaction.fields.getTextInputValue("pseudo_fivem").trim();

                await interaction.reply({ content: `✅ Duel accepté ! Ton pseudo **${challengedIg}** a été enregistré. Rendez-vous sur la map !`, ephemeral: true }).catch(() => {});

                db.get("SELECT * FROM duels WHERE id = ? AND status = 'waiting'", [duelId], async (err, duel) => {
                    if (!duel) return;
                    db.run("UPDATE duels SET challenged_ig = ?, status = 'ongoing' WHERE id = ?", [challengedIg, duelId]);

                    const duelChannel = client.channels.cache.get(DUEL_CHANNEL_ID);
                    const msg = duelChannel ? await duelChannel.messages.fetch(duel.message_id).catch(() => null) : null;

                    const embed = new EmbedBuilder()
                        .setColor(0xFF4500)
                        .setTitle("🎮 DUEL EN COURS !")
                        .setDescription(`Map tirée au sort : **${duel.map_name}**\n\nAllez faire votre meilleur score de drift et cliquez **"J'ai fini"** quand c'est bon !\n\n🏆 Le joueur avec le **plus grand score** remporte le duel !`)
                        .addFields(
                            { name: "🏎️ Challenger", value: `<@${duel.challenger_id}>\n*FiveM : ${duel.challenger_ig}*`, inline: true },
                            { name: "⚔️ VS", value: "\u200b", inline: true },
                            { name: "🏎️ Adversaire", value: `<@${duel.challenged_id}>\n*FiveM : ${challengedIg}*`, inline: true }
                        )
                        .setFooter({ text: "Bonne chance ! 🔥" });

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`duel_done_${duelId}`).setLabel("✅ J'ai fini !").setStyle(ButtonStyle.Success)
                    );

                    if (msg) await msg.edit({ embeds: [embed], components: [row] }).catch(() => {});
                });
            }
            return;
        }

        // ── BOUTONS ──
        if (interaction.isButton()) {

            // Accepter duel — modal immédiat sans attendre la BDD
            if (interaction.customId.startsWith("accept_duel_")) {
                const duelId = interaction.customId.replace("accept_duel_", "");
                const modal = new ModalBuilder()
                    .setCustomId(`modal_accept_duel_${duelId}`)
                    .setTitle("Ton pseudo FiveM");
                const input = new TextInputBuilder()
                    .setCustomId("pseudo_fivem")
                    .setLabel("Ton pseudo exact dans FiveM ?")
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder("Ex: TonyDiaz")
                    .setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(input));
                await interaction.showModal(modal).catch(() => {});
                return;
            }

            // Refuser duel
            if (interaction.customId.startsWith("refuse_duel_")) {
                const duelId = interaction.customId.replace("refuse_duel_", "");
                await interaction.reply({ content: "✅ Duel refusé.", ephemeral: true }).catch(() => {});
                db.get("SELECT * FROM duels WHERE id = ?", [duelId], async (err, duel) => {
                    if (!duel || interaction.user.id !== duel.challenged_id) return;
                    db.run("UPDATE duels SET status = 'refused' WHERE id = ?", [duelId]);
                    const embed = new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle("❌ Duel refusé")
                        .setDescription(`<@${duel.challenged_id}> a refusé le duel de <@${duel.challenger_id}>.`);
                    const duelChannel = client.channels.cache.get(DUEL_CHANNEL_ID);
                    const msg = duelChannel ? await duelChannel.messages.fetch(duel.message_id).catch(() => null) : null;
                    if (msg) await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
                });
                return;
            }

            // J'ai fini le duel
            if (interaction.customId.startsWith("duel_done_")) {
                const duelId = interaction.customId.replace("duel_done_", "");
                await interaction.reply({ content: "✅ Noté ! En attente de l'adversaire...", ephemeral: true }).catch(() => {});

                db.get("SELECT * FROM duels WHERE id = ? AND status = 'ongoing'", [duelId], async (err, duel) => {
                    if (!duel) return;
                    const isChallenger = interaction.user.id === duel.challenger_id;
                    const isChallenged = interaction.user.id === duel.challenged_id;
                    if (!isChallenger && !isChallenged) return;
                    if (isChallenger && duel.challenger_done) return;
                    if (isChallenged && duel.challenged_done) return;

                    if (isChallenger) db.run("UPDATE duels SET challenger_done = 1 WHERE id = ?", [duelId]);
                    if (isChallenged) db.run("UPDATE duels SET challenged_done = 1 WHERE id = ?", [duelId]);

                    const newChallDone = isChallenger ? 1 : duel.challenger_done;
                    const newChalledDone = isChallenged ? 1 : duel.challenged_done;

                    if (newChallDone && newChalledDone) {
                        db.run("UPDATE duels SET status = 'finished' WHERE id = ?", [duelId]);

                        const [challengerScore, challengedScore] = await Promise.all([
                            getPlayerBestScore(duel.challenger_ig, duel.map_name),
                            getPlayerBestScore(duel.challenged_ig, duel.map_name)
                        ]);

                        const duelChannel = client.channels.cache.get(DUEL_CHANNEL_ID);
                        const msg = duelChannel ? await duelChannel.messages.fetch(duel.message_id).catch(() => null) : null;

                        let winner = null, resultText = "";

                        if (!challengerScore && !challengedScore) {
                            resultText = "❌ Aucun score trouvé pour les deux joueurs !";
                        } else if (!challengerScore) {
                            winner = duel.challenged_id;
                            resultText = `Aucun score pour **${duel.challenger_ig}** — victoire de **${duel.challenged_ig}** par forfait !`;
                        } else if (!challengedScore) {
                            winner = duel.challenger_id;
                            resultText = `Aucun score pour **${duel.challenged_ig}** — victoire de **${duel.challenger_ig}** par forfait !`;
                        } else if (challengerScore > challengedScore) {
                            // Le PLUS GRAND score gagne en drift
                            winner = duel.challenger_id;
                            resultText = `**${duel.challenger_ig}** remporte le duel ! 🏆`;
                        } else if (challengedScore > challengerScore) {
                            winner = duel.challenged_id;
                            resultText = `**${duel.challenged_ig}** remporte le duel ! 🏆`;
                        } else {
                            resultText = "🤝 Égalité parfaite !";
                        }

                        const resultEmbed = new EmbedBuilder()
                            .setColor(winner ? 0xFFD700 : 0x808080)
                            .setTitle("🏁 Résultat du duel !")
                            .setDescription(`Map : **${duel.map_name}**\n\n${resultText}`)
                            .addFields(
                                { name: `🏎️ ${duel.challenger_ig}`, value: `🏅 ${formatScore(challengerScore)}`, inline: true },
                                { name: "⚔️ VS", value: "\u200b", inline: true },
                                { name: `🏎️ ${duel.challenged_ig}`, value: `🏅 ${formatScore(challengedScore)}`, inline: true }
                            )
                            .setFooter({ text: "JustDrift • Système de duels" })
                            .setTimestamp();

                        if (msg) await msg.edit({ embeds: [resultEmbed], components: [] }).catch(() => {});
                        if (winner && duelChannel) duelChannel.send(`🏆 GG <@${winner}> ! Tu remportes le duel sur **${duel.map_name}** ! 🔥`).catch(() => {});
                    }
                });
                return;
            }

            // Ouvrir ticket
            if (interaction.customId === "open_ticket") {
                const userId = interaction.user.id;
                const ticketChannel = await interaction.guild.channels.create({
                    name: `ticket-${interaction.user.username}`,
                    type: 0,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: ["ViewChannel"] },
                        { id: userId, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
                        { id: staffRoleId, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] }
                    ]
                });
                const closeRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`close_ticket_${ticketChannel.id}`).setLabel("Fermer le ticket").setStyle(ButtonStyle.Danger)
                );
                await ticketChannel.send({ content: `Bienvenue <@${userId}> ! Un membre du staff va t'aider dès que possible. 👍`, components: [closeRow] });
                return await interaction.reply({ content: `✅ Ton ticket a été créé : ${ticketChannel}`, ephemeral: true });
            }

            // Fermer ticket
            if (interaction.customId.startsWith("close_ticket_")) {
                const ticketChannelId = interaction.customId.replace("close_ticket_", "");
                const ticketChannel = interaction.guild.channels.cache.get(ticketChannelId);
                if (!ticketChannel) return await interaction.reply({ content: "❌ Salon introuvable", ephemeral: true });
                await ticketChannel.setParent("1484878308440281248");
                await ticketChannel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: false, ViewChannel: true });
                await ticketChannel.setName(`${ticketChannel.name}-fermé`);
                return await interaction.reply({ content: "✅ Le ticket a été fermé et archivé !", ephemeral: true });
            }

            // Bouton vote sondage
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
                return await interaction.reply({ content: "🗳️ Choisissez votre réponse :", components: [menu], ephemeral: true });
            }

            // Notation voitures/maps
            if (!interaction.customId.startsWith("rate_") && !interaction.customId.startsWith("ratemap_")) return;
            const id = interaction.customId.replace("rate_", "").replace("ratemap_", "");
            const isMapRating = interaction.customId.startsWith("ratemap_");
            const menu = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`${isMapRating ? "selectmap_" : "select_"}${id}`)
                    .setPlaceholder("Choisis une note sur 10")
                    .addOptions([...Array(10)].map((_, i) => ({ label: `${i + 1}/10`, value: `${i + 1}` })))
            );
            return await interaction.reply({ content: "Choisis ta note :", components: [menu], ephemeral: true });
        }

        // ── MENUS DÉROULANTS ──
        if (interaction.isStringSelectMenu()) {
            if (interaction.customId.startsWith("select_vote_")) {
                const messageId = interaction.customId.replace("select_vote_", "");
                const reponse = interaction.values[0];
                const userId = interaction.user.id;
                await interaction.deferReply({ ephemeral: true }).catch(() => {});

                db.get("SELECT * FROM votes_sondage WHERE message_id = ? AND user_id = ?", [messageId, userId], async (err, row) => {
                    if (row && !interaction.member.roles.cache.has(staffRoleId))
                        return await interaction.editReply({ content: "⚠️ Tu as déjà voté !" }).catch(() => {});
                    db.run(
                        "INSERT INTO votes_sondage (message_id, user_id, reponse) VALUES (?, ?, ?) ON CONFLICT(message_id, user_id) DO UPDATE SET reponse = excluded.reponse",
                        [messageId, userId, reponse],
                        async (err) => {
                            if (err) return await interaction.editReply({ content: "❌ Erreur enregistrement." }).catch(() => {});
                            db.get(
                                "SELECT SUM(CASE WHEN reponse = 'oui' THEN 1 ELSE 0 END) AS oui, SUM(CASE WHEN reponse = 'non' THEN 1 ELSE 0 END) AS non, SUM(CASE WHEN reponse = 'ne_sais_pas' THEN 1 ELSE 0 END) AS ne_sais_pas FROM votes_sondage WHERE message_id = ?",
                                [messageId],
                                async (err, row) => {
                                    if (err) return await interaction.editReply({ content: "❌ Erreur mise à jour." }).catch(() => {});
                                    const oui = row.oui || 0, non = row.non || 0, neSaisPas = row.ne_sais_pas || 0;
                                    const total = oui + non + neSaisPas;
                                    try {
                                        const msg = await interaction.channel.messages.fetch(messageId);
                                        db.get("SELECT question FROM sondages_questions WHERE message_id = ?", [messageId], async (err, row) => {
                                            const question = row ? row.question : "Sondage";
                                            await msg.edit({ content: `📊 **Sondage**\n${question}\n\n✅ Oui : ${oui} votes\n❌ Non : ${non} votes\n❓ Ne sais pas : ${neSaisPas} votes\n\nTotal : ${total} votes` }).catch(() => {});
                                            await interaction.editReply({ content: "✅ Vote enregistré !" }).catch(() => {});
                                        });
                                    } catch { await interaction.editReply({ content: "❌ Erreur mise à jour message." }).catch(() => {}); }
                                }
                            );
                        }
                    );
                });
                return;
            }

            if (!interaction.customId.startsWith("select_") && !interaction.customId.startsWith("selectmap_")) return;
            const isMapRating = interaction.customId.startsWith("selectmap_");
            const vehicleId = interaction.customId.replace("selectmap_", "").replace("select_", "");
            const note = parseInt(interaction.values[0]);
            const userId = interaction.user.id;
            await interaction.deferReply({ ephemeral: true }).catch(() => {});

            db.get("SELECT * FROM votes WHERE vehicle_id = ? AND user_id = ?", [vehicleId, userId], async (err, row) => {
                if (row && !interaction.member.roles.cache.has(staffRoleId))
                    return await interaction.editReply({ content: "⚠️ Tu as déjà noté ce véhicule/parcours !" }).catch(() => {});
                db.run("INSERT INTO votes (vehicle_id, user_id, note) VALUES (?, ?, ?) ON CONFLICT(vehicle_id, user_id) DO UPDATE SET note = excluded.note", [vehicleId, userId, note]);
                db.get("SELECT AVG(note) AS avg, COUNT(*) AS total FROM votes WHERE vehicle_id = ?", [vehicleId], async (err, row) => {
                    try {
                        const avg = row.avg.toFixed(1), total = row.total;
                        const msg = await interaction.channel.messages.fetch(vehicleId);
                        const lignes = msg.content.split('\n');
                        lignes[0] = `⭐ Moyenne : **${avg}/10** (${total} votes)`;
                        await msg.edit({ content: lignes.join('\n') }).catch(() => {});
                        await interaction.editReply({ content: "✅ Ta note a été enregistrée !" }).catch(() => {});
                    } catch { await interaction.editReply({ content: "❌ Erreur mise à jour." }).catch(() => {}); }
                });
            });
        }

    } catch (e) {
        console.error("Erreur interaction:", e?.message || e);
    }
});

client.on("messageCreate", async message => {
    if (message.author.bot) return;

    // ── !duel ──
    if (message.content.startsWith("!duel") && message.channel.id === DUEL_CHANNEL_ID) {
        const mentionRegex = /<@!?(\d+)>/;
        const parts = message.content.split(" ");
        if (parts.length < 3) return message.reply("❌ Utilisation : `!duel @joueur TonPseudoFiveM`");

        const mentionned = message.mentions.users.first();
        if (!mentionned) return message.reply("❌ Mentionne un joueur à défier !");
        if (mentionned.id === message.author.id) return message.reply("❌ Tu ne peux pas te défier toi-même !");
        if (mentionned.bot) return message.reply("❌ Tu ne peux pas défier un bot !");

        const challengerIg = message.content.replace("!duel", "").replace(mentionRegex, "").trim();
        if (!challengerIg) return message.reply("❌ Utilisation : `!duel @joueur TonPseudoFiveM`");

        db.get("SELECT * FROM duels WHERE (challenger_id = ? OR challenged_id = ?) AND status IN ('waiting', 'ongoing')",
            [message.author.id, message.author.id],
            async (err, existing) => {
                if (existing) return message.reply("❌ Tu as déjà un duel en cours ! Utilise `!cancelduel` pour l'annuler.");

                const randomMap = DRIFT_MAPS[Math.floor(Math.random() * DRIFT_MAPS.length)];

                const embed = new EmbedBuilder()
                    .setColor(0xFF8C00)
                    .setTitle("⚔️ DÉFI DE DUEL !")
                    .setDescription(`<@${message.author.id}> défie <@${mentionned.id}> en drift !\n\n🗺️ Map tirée au sort : **${randomMap}**\n\n<@${mentionned.id}>, acceptes-tu le défi ?`)
                    .addFields(
                        { name: "🏎️ Challenger", value: `<@${message.author.id}>\n*FiveM : ${challengerIg}*`, inline: true },
                        { name: "⚔️ VS", value: "\u200b", inline: true },
                        { name: "🏎️ Adversaire", value: `<@${mentionned.id}>`, inline: true }
                    )
                    .setFooter({ text: "Le défi expire dans 5 minutes" })
                    .setTimestamp();

                const duelMsg = await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});

                db.run(
                    "INSERT INTO duels (challenger_id, challenged_id, challenger_ig, map_name, message_id, status) VALUES (?, ?, ?, ?, ?, 'waiting')",
                    [message.author.id, mentionned.id, challengerIg, randomMap, duelMsg.id],
                    function(err) {
                        const duelId = this.lastID;
                        const row = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`accept_duel_${duelId}`).setLabel("✅ Accepter").setStyle(ButtonStyle.Success),
                            new ButtonBuilder().setCustomId(`refuse_duel_${duelId}`).setLabel("❌ Refuser").setStyle(ButtonStyle.Danger)
                        );
                        duelMsg.edit({ embeds: [embed], components: [row] }).catch(() => {});

                        setTimeout(() => {
                            db.get("SELECT status FROM duels WHERE id = ?", [duelId], async (err, row) => {
                                if (row && row.status === 'waiting') {
                                    db.run("UPDATE duels SET status = 'expired' WHERE id = ?", [duelId]);
                                    const expiredEmbed = new EmbedBuilder()
                                        .setColor(0x808080)
                                        .setTitle("⏰ Duel expiré")
                                        .setDescription(`Le défi de <@${message.author.id}> envers <@${mentionned.id}> a expiré.`);
                                    duelMsg.edit({ embeds: [expiredEmbed], components: [] }).catch(() => {});
                                }
                            });
                        }, 5 * 60 * 1000);
                    }
                );
            }
        );
        return;
    }

    // ── !cancelduel ──
    if (message.content.startsWith("!cancelduel") && message.channel.id === DUEL_CHANNEL_ID) {
        const isStaff = message.member.roles.cache.has(staffRoleId);
        const targetUser = message.mentions.users.first();
        const targetId = targetUser ? targetUser.id : message.author.id;

        db.get(
            "SELECT * FROM duels WHERE (challenger_id = ? OR challenged_id = ?) AND status IN ('waiting', 'ongoing')",
            [targetId, targetId],
            async (err, duel) => {
                if (!duel) return message.reply("❌ Aucun duel en cours trouvé.");
                if (!isStaff && message.author.id !== duel.challenger_id)
                    return message.reply("❌ Seul le joueur qui a lancé le duel peut l'annuler.");

                db.run("UPDATE duels SET status = 'cancelled' WHERE id = ?", [duel.id]);
                const cancelEmbed = new EmbedBuilder()
                    .setColor(0x808080)
                    .setTitle("🚫 Duel annulé")
                    .setDescription(
                        isStaff && targetUser
                            ? `Le duel entre <@${duel.challenger_id}> et <@${duel.challenged_id}> a été annulé par le staff.`
                            : `<@${duel.challenger_id}> a annulé le duel contre <@${duel.challenged_id}>.`
                    );

                const duelChannel = client.channels.cache.get(DUEL_CHANNEL_ID);
                const msg = duelChannel ? await duelChannel.messages.fetch(duel.message_id).catch(() => null) : null;
                if (msg) await msg.edit({ embeds: [cancelEmbed], components: [] }).catch(() => {});
                await message.reply("✅ Duel annulé !").catch(() => {});
                await message.delete().catch(() => {});
            }
        );
        return;
    }

    // ── !addcar ──
    if (message.content.startsWith("!addcar")) {
        if (!message.member.roles.cache.has(staffRoleId)) return message.reply("❌ Tu dois avoir le rôle **STAFF**.");
        const nom = message.content.slice(8).trim();
        if (!nom) return message.reply("❌ Utilisation : `!addcar Nom du véhicule` avec une image.");
        if (message.attachments.size === 0) return message.reply("❌ Tu dois joindre une image !");
        const image = message.attachments.first();
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`rate_PLACEHOLDER`).setLabel("Noter ce véhicule").setStyle(ButtonStyle.Primary));
        const carMessage = await message.channel.send({ content: `⭐ Moyenne : **-/10** (0 votes)\n🚗 **${nom}**`, files: [image.url], components: [row] });
        const updatedRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`rate_${carMessage.id}`).setLabel("Noter ce véhicule").setStyle(ButtonStyle.Primary));
        await carMessage.edit({ components: [updatedRow] });
        await message.delete().catch(() => {});
        db.run("INSERT INTO vehicles (vehicle_id, name) VALUES (?, ?)", [carMessage.id, nom]);
    }

    // ── !addmap ──
    if (message.content.startsWith("!addmap")) {
        if (!message.member.roles.cache.has(staffRoleId)) return message.reply("❌ Tu dois avoir le rôle **STAFF**.");
        const nom = message.content.slice(8).trim();
        if (!nom) return message.reply("❌ Utilisation : `!addmap Nom du parcours` avec une image.");
        if (message.attachments.size === 0) return message.reply("❌ Tu dois joindre une image !");
        const image = message.attachments.first();
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ratemap_PLACEHOLDER`).setLabel("Noter ce parcours").setStyle(ButtonStyle.Success));
        const mapMessage = await message.channel.send({ content: `⭐ Moyenne : **-/10** (0 votes)\n🗺️ **${nom}**`, files: [image.url], components: [row] });
        const updatedRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ratemap_${mapMessage.id}`).setLabel("Noter ce parcours").setStyle(ButtonStyle.Success));
        await mapMessage.edit({ components: [updatedRow] });
        await message.delete().catch(() => {});
        db.run("INSERT INTO maps (map_id, name) VALUES (?, ?)", [mapMessage.id, nom]);
    }

    // ── !addvote ──
    if (message.content.startsWith("!addvote")) {
        if (!message.member.roles.cache.has(staffRoleId)) return message.reply("❌ Tu dois avoir le rôle **STAFF**.");
        const question = message.content.slice(9).trim();
        if (!question) return message.reply("❌ Utilisation : `!addvote Votre question`");
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`vote_button_PLACEHOLDER`).setLabel("Votez").setStyle(ButtonStyle.Primary));
        const voteMessage = await message.channel.send({ content: `📊 **Sondage**\n${question}\n\n✅ Oui : 0 votes\n❌ Non : 0 votes\n❓ Ne sais pas : 0 votes\n\nTotal : 0 votes`, components: [row] });
        const updatedRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`vote_button_${voteMessage.id}`).setLabel("Votez").setStyle(ButtonStyle.Primary));
        await voteMessage.edit({ components: [updatedRow] });
        db.run("INSERT INTO sondages_questions (message_id, question) VALUES (?, ?)", [voteMessage.id, question]);
        await message.delete().catch(() => {});
    }

    // ── !topcar ──
    if (message.content === "!topcar") {
        db.all("SELECT votes.vehicle_id, AVG(votes.note) AS moyenne, COUNT(votes.user_id) AS votes_count, vehicles.name FROM votes LEFT JOIN vehicles ON votes.vehicle_id = vehicles.vehicle_id GROUP BY votes.vehicle_id ORDER BY moyenne DESC LIMIT 10",
            async (err, rows) => {
                if (err || !rows || rows.length === 0) return message.reply("❌ Aucun véhicule noté pour le moment.");
                let topMessage = "🏆 **TOP 10 DES MEILLEURS VÉHICULES** 🏆\n\n";
                for (let i = 0; i < rows.length; i++) {
                    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
                    topMessage += `${medal} **${rows[i].name || `Véhicule ${rows[i].vehicle_id}`}** - ⭐ ${rows[i].moyenne.toFixed(1)}/10 (${rows[i].votes_count} vote${rows[i].votes_count > 1 ? 's' : ''})\n`;
                }
                topMessage += "\n📊 **Classement basé sur la moyenne des notes**";
                message.reply(topMessage);
            }
        );
    }

    // ── !topmap ──
    if (message.content === "!topmap") {
        db.all("SELECT votes.vehicle_id, AVG(votes.note) AS moyenne, COUNT(votes.user_id) AS votes_count, maps.name FROM votes LEFT JOIN maps ON votes.vehicle_id = maps.map_id GROUP BY votes.vehicle_id ORDER BY moyenne DESC LIMIT 10",
            async (err, rows) => {
                if (err || !rows || rows.length === 0) return message.reply("❌ Aucune map notée pour le moment.");
                let topMessage = "🏆 **TOP 10 DES MEILLEURES MAPS** 🏆\n\n";
                for (let i = 0; i < rows.length; i++) {
                    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
                    topMessage += `${medal} **${rows[i].name || `Map ${rows[i].vehicle_id}`}** - ⭐ ${rows[i].moyenne.toFixed(1)}/10 (${rows[i].votes_count} vote${rows[i].votes_count > 1 ? 's' : ''})\n`;
                }
                topMessage += "\n📊 **Classement basé sur la moyenne des notes**";
                message.reply(topMessage);
            }
        );
    }
});

client.login(process.env.TOKEN);
