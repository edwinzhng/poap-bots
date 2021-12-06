# POAP Discord Bot

POAP Discord bot for sales acitivity on [OpenSea](https://opensea.io/collection/poap-v2).

Based off of the bot provided by [0xEssential/opensea-discord-bot](https://github.com/0xEssential/opensea-discord-bot).

## Running the Bot

1. Copy `.env.sample` into a new file called `.env` and set the values correctly
```
cp .env.sample .env
```

2. Make sure Node.js 14+ is installed and install dependencies
```
yarn install
```

3. Run the server
```
yarn ts-node ./bot.ts
```

The bot can be deployed the same way as described above on a cloud platform or local computer. Currently, it is hosted on an AWS t2.micro instance which is free for 1 year, but could also be hosted on other platforms like Heroku.
