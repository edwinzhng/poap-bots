import "dotenv/config";
import Discord, { TextChannel } from "discord.js";
import fetch from "node-fetch";
import { ethers, providers } from "ethers";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Fetch last SECS_TO_CHECK seconds in case realtime updates are missed
const SECS_TO_CHECK = 120;
const SECS_TO_SLEEP = 20;

const OPENSEA_LOGO =
  "https://files.readme.io/566c72b-opensea-logomark-full-colored.png";
const OPENSEA_API_EVENTS_URL = "https://api.opensea.io/api/v1/events?";

const POAP_GALLERY_BASE_URL = "https://poap.gallery/event/";
const POAP_SCAN_BASE_URL = "https://app.poap.xyz/scan/";

const ETHERSCAN_TX_BASE_URL = "https://etherscan.io/tx/";

const COLORS = {
  blue: "#0099ff",
  green: "#197468",
  pink: "#E77B93",
};

enum EventType {
  "transfer",
  "successful",
}

const provider = new providers.EtherscanProvider(
  "homestead",
  process.env.ETHERSCAN_API_KEY
);
const discordBot = new Discord.Client();
discordBot.login(process.env.DISCORD_BOT_TOKEN);

const seenTransactionTimes = new Object({});
const seenTransactions = new Set<string>();

const sleep = (ms: number): Promise<any> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const getCurrentSeconds = (): number => {
  return Math.round(new Date().getTime() / 1000);
};

const evictSeenTransactions = () => {
  // Delete seen transactions older than SECS_TO_CHECK * 2
  const currentSec = getCurrentSeconds();
  const transactionsToRemove = new Array<string>();
  seenTransactions.forEach((value) => {
    if (seenTransactionTimes[value] < currentSec - SECS_TO_CHECK * 2) {
      transactionsToRemove.push(value);
    }
  });
  transactionsToRemove.forEach((value) => {
    seenTransactions.delete(value);
    delete seenTransactionTimes[value];
  });
}

const hyperlinkAddr = async (addr: string): Promise<string> => {
  if (addr === ZERO_ADDRESS) {
    return addr;
  }
  const addressUrl = POAP_SCAN_BASE_URL + addr;
  const ensName = await provider.lookupAddress(addr);
  return `[${ensName || addr}](${addressUrl})`;
};

const buildMessage = async (event: any, eventType: EventType) => {
  const asset = event.asset;

  const poapEventId = asset.external_link.split("/").reverse()[1];
  const eventUrl = POAP_GALLERY_BASE_URL + poapEventId;

  const transactionHash = event.transaction.transaction_hash;
  const transactionUrl = ETHERSCAN_TX_BASE_URL + transactionHash;
  const eventInline = eventType === EventType.successful;

  let message = new Discord.MessageEmbed()
    .setThumbnail(asset.image_url)
    .setURL(asset.permalink)
    .setTimestamp(Date.parse(`${event?.created_date}Z`))
    .addField(
      "Event",
      `[${asset.name} (#${poapEventId})](${eventUrl})`,
      eventInline
    );

  if (eventType === EventType.transfer) {
    const fromAddress = event?.from_account?.address;
    const titleText = fromAddress === ZERO_ADDRESS ? "Minted" : "Transfer";
    const color = fromAddress === ZERO_ADDRESS ? COLORS.blue : COLORS.pink;
    const to = await hyperlinkAddr(event?.to_account?.address);
    const from = await hyperlinkAddr(fromAddress);
    message = message
      .addFields({ name: "To", value: to }, { name: "From", value: from })
      .setColor(color)
      .setTitle(`${titleText}: ${asset.name}`);
    if (fromAddress !== ZERO_ADDRESS) {
      message = message.setFooter("Transferred on OpenSea", OPENSEA_LOGO);
    } else {
      message = message.setFooter("From OpenSea", OPENSEA_LOGO);
    }
  } else if (eventType === EventType.successful) {
    const price = `${ethers.constants.EtherSymbol}${ethers.utils.formatEther(
      event.total_price || "0"
    )}`;
    const buyer = await hyperlinkAddr(event?.winner_account?.address);
    const seller = await hyperlinkAddr(event?.seller?.address);
    message = message
      .addFields(
        { name: "Amount", value: price, inline: true },
        { name: "Buyer", value: buyer },
        { name: "Seller", value: seller }
      )
      .setColor(COLORS.green)
      .setTitle(`Sold: ${asset.name}`)
      .setFooter("Sold on OpenSea", OPENSEA_LOGO);
  }

  message = message.addField(
    "Transaction",
    `[${transactionHash}](${transactionUrl})`
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

const processEvent = async (
  event: any,
  eventType: EventType,
  channel: TextChannel,
  endSeconds: number
) => {
  const txHash: string = event.transaction.transaction_hash;
  if (seenTransactions.has(txHash)) {
    return Promise.resolve(0);
  }
  seenTransactions.add(txHash);
  seenTransactionTimes[txHash] = endSeconds;
  if (event.asset.name == null) event.asset.name = "Unnamed NFT";
  const message = await buildMessage(event, eventType);
  await channel.send(message);
  return Promise.resolve(1);
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

  let numMessages = 0;
  const openseaSales = await fetchOpensea(salesParams);
  await Promise.all(
    openseaSales?.asset_events?.map(async (event: any) => {
      numMessages += await processEvent(event, EventType.successful, channel, endSeconds);
    })
  );
  const openseaTransfers = await fetchOpensea(transferParams);
  await Promise.all(
    openseaTransfers?.asset_events?.map(async (event: any) => {
      numMessages += await processEvent(event, EventType.transfer, channel, endSeconds);
    })
  );

  return numMessages;
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
  const channel = await getDiscordChannel(
    discordBot,
    process.env.DISCORD_CHANNEL_ID
  );

  try {
    let timeEnd = getCurrentSeconds();
    let timeStart = timeEnd;
    while (true) {
      sendDiscordMessages(channel, timeStart, timeEnd)
        .then((res) => {
          const eventText = res === 1 ? "event" : "events";
          const startDate = new Date(timeStart * 1000).toLocaleString();
          const endDate = new Date(timeEnd * 1000).toLocaleString();
          console.log(
            `${res} new ${eventText} between ${startDate} and ${endDate}`
          );
        })
        .catch((error) => {
          console.error(error);
        });
      await sleep(SECS_TO_SLEEP * 1000);
      evictSeenTransactions();
      timeStart = timeEnd - SECS_TO_CHECK;
      timeEnd = getCurrentSeconds();
    }
  } finally {
    discordBot.destroy();
  }
};

main();
