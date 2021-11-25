# POAP Twitter Bot

POAP Twitter bot [@POAPBot](https://twitter.com/POAPBot) for daily token activity updates:

[![github-readme-twitter](https://github-readme-twitter.gazf.vercel.app/api?id=POAPBot)](https://twitter.com/POAPBot)

POAP data is pulled from the [POAP subgraphs](https://github.com/poap-xyz/poap-subgraph).

## Development

1. Copy `.env.sample` into a new file called `.env` and set the values to your Twitter API keys
```
cp .env.sample .env
```

2. Run the function using `python run_local.py`

## Deployment

1. Build the Lambda function + layer using `./build.sh [PYTHON_VERSION]` (currently uses Python 3.8)
```
./build.sh 3.8
```

2. Upload build files to Lambda and set up daily schedule using EventBridge. Currently, the bot is deployed to tweet at 2:00am UTC daily, with information on all activity from the previous day. This assumes that the subgraph data is updated within 2 hours of transfers happening so we can accurately capture all data from the day before.
