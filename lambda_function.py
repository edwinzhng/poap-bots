import datetime
import os
from time import time
from typing import Dict, List, Optional

import tweepy
from gql import Client, gql
from gql.transport.requests import RequestsHTTPTransport

TWEET_MSG = """
-- Mainnet --
Total Transfers: {total_transfers}
"""

SUBGRAPH_MAINNET_URL = "https://api.thegraph.com/subgraphs/name/poap-xyz/poap"
SUBGRAPH_XDAI_URL = "https://api.thegraph.com/subgraphs/name/poap-xyz/poap-xdai"


def _get_yesterday_unix_timestamp_utc():
    today = datetime.datetime.fromtimestamp(time(), datetime.timezone.utc)
    yesterday = today - datetime.timedelta(1)
    yesterday_start_sec = int(yesterday.strftime("%s"))
    return yesterday_start_sec


def _execute_gql(query, url: str, variable_values: Optional[Dict] = None) -> Client:
    transport = RequestsHTTPTransport(
        url=url,
        use_json=True,
        headers={
            "Content-type": "application/json",
        },
        retries=3,
    )
    client = Client(transport=transport, fetch_schema_from_transport=True)
    data = client.execute(query, variable_values=variable_values)
    return data


def _fetch_subgraph_stats(url: str) -> List[Dict]:
    yesterday_start_sec = _get_yesterday_unix_timestamp_utc()
    query = gql('''
        query poapTransfers {
            transfers(where: { timestamp_gt: $yesterdayStartSec }) {
                id
                timestamp
                from {
                    id
                }
            }
        }
    ''')
    variable_values = {
        "yesterdayStartSec": yesterday_start_sec
    }
    data = _execute_gql(query, variable_values)
    transfers = data["transfers"]
    return transfers


def _auth_tweepy() -> tweepy.API:
    # Fetch credentials
    consumer_key = os.getenv("CONSUMER_KEY")
    consumer_secret = os.getenv("CONSUMER_SECRET")
    access_token = os.getenv("ACCESS_TOKEN")
    access_token_secret = os.getenv("ACCESS_TOKEN_SECRET")

    # Authenticate
    auth = tweepy.OAuthHandler(consumer_key, consumer_secret)
    auth.set_access_token(access_token, access_token_secret)
    return tweepy.API(auth)


def _tweet_network_stats() -> None:
    mainnet_transfers = _fetch_subgraph_stats(SUBGRAPH_MAINNET_URL)
    msg = TWEET_MSG.format(
        total_transfers=len(mainnet_transfers),
    )

    print(f"Sending tweet:\n{msg}")
    api = _auth_tweepy()
    # api.update_status(msg)


def lambda_handler(event, context):
    """Entrypoint for deploying to AWS Lambda"""
    _tweet_network_stats()
    return
