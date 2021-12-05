import "dotenv/config";
import Discord, { TextChannel } from "discord.js";
import fetch from "node-fetch";
import { ethers } from "ethers";

const discordBot = new Discord.Client();

const discordSetup = async (channel: string): Promise<TextChannel> => {
  const channelID = channel;
  return new Promise<TextChannel>((resolve, reject) => {
    discordBot.login(process.env.DISCORD_BOT_TOKEN);
    discordBot.on("ready", async () => {
      const channel = await discordBot.channels.fetch(channelID!);
      resolve(channel as TextChannel);
    });
  });
};

const buildMessage = (sale: any) =>
  new Discord.MessageEmbed()
    .setColor("#0099ff")
    .setTitle(sale.asset.name + " sold!")
    .setURL(sale.asset.permalink)
    .setAuthor(
      "OpenSea Bot",
      "https://files.readme.io/566c72b-opensea-logomark-full-colored.png",
      "https://github.com/edwinzhng/poap-bots"
    )
    .setThumbnail(sale.asset.collection.image_url)
    .addFields(
      { name: "Name", value: sale.asset.name },
      {
        name: "Amount",
        value: `${ethers.utils.formatEther(sale.total_price || "0")}${
          ethers.constants.EtherSymbol
        }`,
      },
      { name: "Buyer", value: sale?.winner_account?.address },
      { name: "Seller", value: sale?.seller?.address }
    )
    .setImage(sale.asset.image_url)
    .setTimestamp(Date.parse(`${sale?.created_date}Z`))
    .setFooter(
      "Sold on OpenSea",
      "https://files.readme.io/566c72b-opensea-logomark-full-colored.png"
    );

async function main() {
  const seconds = process.env.SECONDS ? parseInt(process.env.SECONDS) : 3_600;
  const hoursAgo = Math.round(new Date().getTime() / 1000) - seconds; // in the last hour, run hourly?

  const params = new URLSearchParams({
    offset: "0",
    event_type: "successful",
    only_opensea: "false",
    occurred_after: hoursAgo.toString(),
    collection_slug: process.env.COLLECTION_SLUG!,
    asset_contract_address: process.env.CONTRACT_ADDRESS!,
  });

  let openSeaFetch = {};
  openSeaFetch["headers"] = { "X-API-KEY": process.env.OPENSEA_API_KEY };

  let responseText = "";
  try {
    const openSeaResponseObj = await fetch(
      "https://api.opensea.io/api/v1/events?" + params,
      openSeaFetch
    );
    responseText = await openSeaResponseObj.text();
    const openSeaResponse = JSON.parse(responseText);

    return await Promise.all(
      openSeaResponse?.asset_events?.reverse().map(async (sale: any) => {
        if (sale.asset.name == null) sale.asset.name = "Unnamed NFT";

        const message = buildMessage(sale);
        return await Promise.all(
          process.env.DISCORD_CHANNEL_ID.split(";").map(
            async (channel: string) => {
              return await (await discordSetup(channel)).send(message);
            }
          )
        );
      })
    );
  } catch (e) {
    const payload = responseText || "";
    if (payload.includes("cloudflare") && payload.includes("1020")) {
      throw new Error(
        "You are being rate-limited by OpenSea. Please retrieve an OpenSea API token here: https://docs.opensea.io/reference/request-an-api-key"
      );
    }
    throw e;
  }
}

export const lambdaHandler = async (event: any) => {
  let status: number = 200;
  let message: string;

  main()
    .then((res) => {
      message = `Published ${res.length || 0} events`;
    })
    .catch((error) => {
      console.error(error);
      status = 400;
      message = "Failed to publish events";
    });

  const response = {
    statusCode: status,
    body: JSON.stringify(message),
  };
  return response;
};
