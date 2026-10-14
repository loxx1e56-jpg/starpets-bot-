import {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import dotenv from "dotenv";

dotenv.config();

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const MAX_PRICE_GBP = 1.0;
const MIN_EARNING_DEFAULT = 100;
const ITEMS_PER_PAGE = 10;

const GAMES = {
  "steal-brainrot": {
    label: "Steal a Brainrot",
    store: "sab-market.apineural.com",
    siteUrl: "https://starpets.gg/steal-brainrot",
  },
  "adopt-me": {
    label: "Adopt Me",
    store: "market.apineural.com",
    siteUrl: "https://starpets.gg/adopt-me",
  },
  "mm2": {
    label: "Murder Mystery 2",
    store: "mm2-market.apineural.com",
    siteUrl: "https://starpets.gg/mm2",
  },
  "grow-a-garden": {
    label: "Grow a Garden",
    store: "gag-market.apineural.com",
    siteUrl: "https://starpets.gg/grow-a-garden",
  },
};

const USD_TO_GBP = 0.79;
const GBP_TO_USD = 1.27;

const dealSessions = new Map();
let sessionCounter = 0;

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const rest = new REST({ version: "10" }).setToken(TOKEN);

const commands = [
  new SlashCommandBuilder()
    .setName("deals")
    .setDescription("Browse StarPets secret listings with high earnings under your price limit")
    .addStringOption((option) =>
      option
        .setName("game")
        .setDescription("Which game to search listings for (skip to pick from a menu)")
        .setRequired(false)
        .addChoices(
          { name: "Steal a Brainrot", value: "steal-brainrot" },
          { name: "Adopt Me", value: "adopt-me" },
          { name: "Murder Mystery 2", value: "mm2" },
          { name: "Grow a Garden", value: "grow-a-garden" },
        ),
    )
    .addNumberOption((option) =>
      option
        .setName("min-earning")
        .setDescription("Minimum in-game earning value in millions (default: 100)")
        .setRequired(false),
    )
    .addNumberOption((option) =>
      option
        .setName("max-price")
        .setDescription("Maximum price in GBP (default: 1)")
        .setRequired(false),
    )
    .toJSON(),
];

async function registerCommands() {
  try {
    console.log("Registering slash commands...");
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("Slash commands registered.");
  } catch (error) {
    console.error("Failed to register commands:", error);
  }
}

client.once("ready", () => {
  console.log(`Bot logged in as ${client.user.tag}`);
  registerCommands();
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === "deals") {
    await handleDealsCommand(interaction);
  } else if (interaction.isStringSelectMenu() && interaction.customId === "game-select") {
    await handleGameSelect(interaction);
  } else if (interaction.isButton() && interaction.customId.startsWith("dealsnav:")) {
    await handlePageButton(interaction);
  }
});

async function handleDealsCommand(interaction) {
  const game = interaction.options.getString("game");
  const minEarningM = interaction.options.getNumber("min-earning") ?? MIN_EARNING_DEFAULT;
  const maxPrice = interaction.options.getNumber("max-price") ?? MAX_PRICE_GBP;

  if (game) {
    await fetchAndShowDeals(interaction, game, minEarningM, maxPrice);
  } else {
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("game-select")
        .setPlaceholder("Pick a game...")
        .addOptions(
          Object.entries(GAMES).map(([value, g]) => ({
            label: g.label,
            value: `${value}|${minEarningM}|${maxPrice}`,
          })),
        ),
    );

    const embed = new EmbedBuilder()
      .setTitle("StarPets Deal Finder")
      .setDescription(
        "Select a game below to browse secret listings with high earnings under your price limit.\n\n" +
          `Defaults: earning >= ${minEarningM}m, price <= ${formatGbp(maxPrice)}`,
      )
      .setColor(0x3498db);

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }
}

async function handleGameSelect(interaction) {
  const [gameKey, minEarningM, maxPrice] = interaction.values[0].split("|");
  await interaction.deferUpdate();
  await fetchAndShowDeals(interaction, gameKey, parseFloat(minEarningM), parseFloat(maxPrice));
}

async function handlePageButton(interaction) {
  const parts = interaction.customId.split(":");
  const sessionId = parts[1];
  const direction = parts[2];

  const session = dealSessions.get(sessionId);
  if (!session) {
    await interaction.update({
      content: "This deal search has expired. Please run /deals again.",
      embeds: [],
      components: [],
    });
    return;
  }

  if (direction === "next") session.page++;
  else if (direction === "prev") session.page--;

  await interaction.deferUpdate();
  await showDealsPage(interaction, session);
}

async function fetchAndShowDeals(interaction, gameKey, minEarningM, maxPriceGbp) {
  const game = GAMES[gameKey];
  if (!game) {
    await interaction.reply({ content: "Unknown game selected.", ephemeral: true });
    return;
  }

  const thinking = interaction.deferred || interaction.replied;
  if (!thinking) {
    await interaction.deferReply({ ephemeral: true });
  }

  const minEarning = minEarningM * 1_000_000;
  const maxPriceUsd = maxPriceGbp * GBP_TO_USD;

  try {
    const items = await fetchAllSecretsUnderPrice(game.store, maxPriceUsd, minEarning);

    if (items.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle(`No deals found for ${game.label}`)
        .setDescription(
          `No secret items found with earning >= ${minEarningM}m under ${formatGbp(maxPriceGbp)}.`,
        )
        .setColor(0xe74c3c)
        .setFooter({ text: "Try increasing the max price or lowering the min earning." });

      await interaction.editReply({ embeds: [embed], components: [] });
      return;
    }

    items.sort((a, b) => b.earning - a.earning);

    const sessionId = `${++sessionCounter}`;
    const session = {
      id: sessionId,
      gameKey,
      items,
      page: 0,
      minEarningM,
      maxPriceGbp,
      createdAt: Date.now(),
    };
    dealSessions.set(sessionId, session);

    await showDealsPage(interaction, session);
  } catch (error) {
    console.error("Fetch error:", error);
    await interaction.editReply({
      content: `Failed to fetch listings from StarPets: ${error.message}`,
    });
  }
}

async function showDealsPage(interaction, session) {
  const game = GAMES[session.gameKey];
  const totalPages = Math.ceil(session.items.length / ITEMS_PER_PAGE);
  const pageIdx = session.page;
  const slice = session.items.slice(pageIdx * ITEMS_PER_PAGE, (pageIdx + 1) * ITEMS_PER_PAGE);

  const embed = new EmbedBuilder()
    .setTitle(`${game.label} - Secret Deals`)
    .setDescription(
      `Found **${session.items.length}** secret listings with earning >= ${session.minEarningM}m under ${formatGbp(session.maxPriceGbp)}\n` +
        `Page ${pageIdx + 1} of ${totalPages}`,
    )
    .setColor(0x2ecc71)
    .setURL(game.siteUrl)
    .setFooter({ text: "Prices converted from USD to GBP. Earnings shown in millions." });

  for (const item of slice) {
    const earningM = (item.earning / 1_000_000).toFixed(0);
    const priceGbp = (item.price * USD_TO_GBP).toFixed(2);
    const mutationLabel = item.mutation && item.mutation !== "default" ? ` (${formatMutation(item.mutation)})` : "";
    embed.addFields({
      name: `${item.name}${mutationLabel}`,
      value: `Earning: **${earningM}m** | Price: **\u00a3${priceGbp}** | ${item.imageUri ? `[Image](${item.imageUri})` : ""}`,
      inline: false,
    });
  }

  const buttons = [];
  if (pageIdx > 0) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`dealsnav:${session.id}:prev`)
        .setLabel("\u2190 Previous")
        .setStyle(ButtonStyle.Primary),
    );
  }
  if (pageIdx < totalPages - 1) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`dealsnav:${session.id}:next`)
        .setLabel("Next \u2192")
        .setStyle(ButtonStyle.Primary),
    );
  }

  const components = buttons.length > 0 ? [new ActionRowBuilder().addComponents(...buttons)] : [];

  await interaction.editReply({ embeds: [embed], components });
}

async function fetchAllSecretsUnderPrice(store, maxPriceUsd, minEarning) {
  const allSecrets = [];
  let page = 1;
  const amount = 72;
  let total = Infinity;

  while (page * amount <= total + amount) {
    const body = {
      filter: { types: [{ type: "pet" }], price: { max: maxPriceUsd } },
      page,
      amount,
      currency: "usd",
      sort: { price: "desc" },
    };

    const res = await fetch(`https://${store}/api/store/items/all`, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        Origin: "https://starpets.gg",
        Referer: "https://starpets.gg/",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`API returned status ${res.status}`);
    }

    const data = await res.json();
    if (!data.items || data.items.length === 0) break;

    total = data.count;
    const secrets = data.items.filter((i) => i.rare === "secret" && i.earning >= minEarning);
    allSecrets.push(...secrets);

    page++;
  }

  const seen = new Set();
  return allSecrets.filter((i) => {
    const key = i.goodId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatGbp(amount) {
  return `\u00a3${amount.toFixed(2)}`;
}

function formatMutation(mutation) {
  return mutation
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of dealSessions) {
    if (now - session.createdAt > 15 * 60 * 1000) {
      dealSessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

if (!TOKEN) {
  console.error("DISCORD_BOT_TOKEN is not set in .env file.");
  console.error("Create a bot at https://discord.com/developers/applications and add the token to your .env file.");
  process.exit(1);
}

client.login(TOKEN);
