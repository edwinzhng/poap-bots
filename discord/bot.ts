import "dotenv/config";
import Discord, { TextChannel } from "discord.js";
import fetch from "node-fetch";
import { ethers } from "ethers";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const OPENSEA_LOGO =
  "https://files.readme.io/566c72b-opensea-logomark-full-colored.png";
const OPENSEA_API_EVENTS_URL = "https://api.opensea.io/api/v1/events?";

const POAP_GALLERY_BASE_URL = "https://poap.gallery/event/";

const ETHERSCAN_TX_BASE_URL = "https://etherscan.io/tx/";
const ETHERSCAN_ADDR_BASE_URL = "https://etherscan.io/address/";

const COLORS = {
  blue: "#0099ff",
  green: "#197468",
  pink: "#E77B93",
};

enum EventType {
  "transfer",
  "successful",
}

const sleep = (ms: number): Promise<any> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const getCurrentSeconds = (): number => {
  return Math.round(new Date().getTime() / 1000);
};

const hyperlinkAddr = (addr: string): string => {
  const addressUrl = ETHERSCAN_ADDR_BASE_URL + addr;
  return `[${addr}](${addressUrl})`;
};

const buildMessage = (event: any, eventType: EventType) => {
  const asset = event.asset;

  const poapEventId = asset.external_link.split("/").reverse()[1];
  const eventUrl = POAP_GALLERY_BASE_URL + poapEventId;

  const transactionHash = event.transaction.transaction_hash;
  const transactionUrl = ETHERSCAN_TX_BASE_URL + transactionHash;

  let message = new Discord.MessageEmbed()
    .setThumbnail(asset.collection.image_url)
    .setURL(asset.permalink)
    .setImage(asset.image_url)
    .setTimestamp(Date.parse(`${event?.created_date}Z`))
    .addField("Event", `[${asset.name} (#${poapEventId})](${eventUrl})`, true);

  if (eventType == EventType.transfer) {
    const fromAddress = event?.from_account?.address;
    const titleText = fromAddress === ZERO_ADDRESS ? "Minted" : "Transfer";
    const color = fromAddress === ZERO_ADDRESS ? COLORS.blue : COLORS.pink;
    message = message
      .addFields(
        { name: "To", value: hyperlinkAddr(event?.to_account?.address) },
        { name: "From", value: hyperlinkAddr(fromAddress) }
      )
      .setColor(color)
      .setTitle(`${titleText}: ${asset.name}`);
    if (fromAddress !== ZERO_ADDRESS) {
      message = message.setFooter("Transferred on OpenSea", OPENSEA_LOGO);
    }
  } else if (eventType == EventType.successful) {
    message = message
      .addFields(
        {
          name: "Amount",
          value: `${ethers.constants.EtherSymbol}${ethers.utils.formatEther(
            event.total_price || "0"
          )}`,
        },
        { name: "Buyer", value: hyperlinkAddr(event?.winner_account?.address) },
        { name: "Seller", value: hyperlinkAddr(event?.seller?.address) }
      )
      .setColor(COLORS.green)
      .setTitle(`Sold: ${asset.name}`)
      .setFooter("Sold on OpenSea", OPENSEA_LOGO);
  }

  message = message.addField(
    "Transaction",
    `[${transactionUrl}](transactionUrl)`
  );
  return message;
};

const fetchOpensea = async (urlParams: URLSearchParams): Promise<any> => {
  let responseText = "";
  let openSeaFetch = { headers: { "X-API-KEY": process.env.OPENSEA_API_KEY } };
  try {
    const openSeaResponseObj = await fetch(
      OPENSEA_API_EVENTS_URL + urlParams,
      openSeaFetch
    );
    responseText = await openSeaResponseObj.text();
    const openSeaResponse = JSON.parse(responseText);
    return openSeaResponse;
  } catch (e) {
    const payload = responseText || "";
    if (payload.includes("cloudflare") && payload.includes("1020")) {
      throw new Error("You are being rate-limited by OpenSea");
    }
    throw e;
  }
};

const sendDiscordMessages = async (
  channel: TextChannel,
  startSeconds: number,
  endSeconds: number
): Promise<number> => {
  const baseParams = {
    offset: "0",
    only_opensea: "false",
    occurred_before: endSeconds.toString(),
    occurred_after: startSeconds.toString(),
    collection_slug: process.env.OPENSEA_COLLECTION!,
    asset_contract_address: process.env.OPENSEA_CONTRACT_ADDRESS!,
    limit: "300",
  };
  const salesParams = new URLSearchParams({
    event_type: "successful",
    ...baseParams,
  });
  const transferParams = new URLSearchParams({
    event_type: "transfer",
    ...baseParams,
  });

  const openseaSales = await fetchOpensea(salesParams);
  await Promise.all(
    openseaSales?.asset_events?.reverse().map(async (event: any) => {
      if (event.asset.name == null) event.asset.name = "Unnamed NFT";
      const message = buildMessage(event, EventType.successful);
      return await channel.send(message);
    })
  );

  const openseaTransfers = await fetchOpensea(transferParams);
  await Promise.all(
    openseaTransfers?.asset_events?.reverse().map(async (event: any) => {
      if (event.asset.name == null) event.asset.name = "Unnamed NFT";
      const message = buildMessage(event, EventType.transfer);
      return await channel.send(message);
    })
  );
  const numSales = openseaSales?.asset_events?.length || 0;
  const numTransfers = openseaTransfers?.asset_events?.length || 0;
  return numSales + numTransfers;
};

const getDiscordChannel = async (
  client: Discord.Client,
  channel: string
): Promise<TextChannel> => {
  const channelID = channel;
  return new Promise<TextChannel>((resolve, _) => {
    client.on("ready", async () => {
      const channel = await client.channels.fetch(channelID!);
      resolve(channel as TextChannel);
    });
  });
};

const main = async () => {
  const discordBot = new Discord.Client();
  discordBot.login(process.env.DISCORD_BOT_TOKEN);
  const channel = await getDiscordChannel(
    discordBot,
    process.env.DISCORD_CHANNEL_ID
  );

  try {
    let timeEnd = getCurrentSeconds();
    let timeStart = timeEnd - 1000; // Start by fetching last 30 seconds  
    while (true) {
      sendDiscordMessages(channel, timeStart, timeEnd)
        .then((res) => {
          const eventText = res === 1 ? "event" : "events";
          const startDate = new Date(timeStart * 1000);
          const endDate = new Date(timeEnd * 1000);
          console.log(
            `Published ${res} ${eventText} between ${startDate} and ${endDate}`
          );
        })
        .catch((error) => {
          console.error(error);
        });
      await sleep(20000);
      timeStart = timeEnd;
      timeEnd = getCurrentSeconds();
    }
  } finally {
    discordBot.destroy();
  }
};

main();
