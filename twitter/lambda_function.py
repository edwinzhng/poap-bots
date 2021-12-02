import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

import requests
import tweepy
from gql import Client, gql
from gql.transport.requests import RequestsHTTPTransport

TWEET_MSG = """
📸 {network} snapshot ({date})
Transfers: {total_transfers} ({minted} tokens minted)
Events: {events}

🏆 Event Leaderboard:
{leaderboard}
"""

POAP_EVENT_BASE_URL = "https://api.poap.xyz/events/id/"
SUBGRAPH_MAINNET_URL = "https://api.thegraph.com/subgraphs/name/poap-xyz/poap"
SUBGRAPH_XDAI_URL = "https://api.thegraph.com/subgraphs/name/poap-xyz/poap-xdai"
SECONDS_PER_HOUR = 60 * 60
FIRST_TO_FETCH = 1000
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def _get_yesterday_unix_timestamp_utc():
    """Get the unix timestamp of the 2 days ago at midnight"""
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday = today - timedelta(days=2)
    yesterday_start_sec = int(yesterday.timestamp())
    return yesterday, yesterday_start_sec


def _fetch_event_name(event_id: int):
    url = POAP_EVENT_BASE_URL + str(event_id)
    event = requests.get(url).json()
    return event.get("name")


def _event_leaderboard(event_transfers: Dict) -> str:
    events_sorted = sorted(event_transfers.items(), key=lambda x: -x[1])
    leaderboard = []
    i = 0
    while i < 3 and i < len(events_sorted):
        event = events_sorted[i]
        event_id = int(event[0])
        event_transfers = int(event[1])
        event_name = _fetch_event_name(event_id)
        transfer_text = "transfer" if event_transfers == 1 else "transfers"
        leaderboard.append(f"{i + 1}. {event_name} ({event_transfers} {transfer_text})")
        i += 1
    return "\n".join(leaderboard)


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


def _fetch_subgraph_stats(yesterday_sec: int, url: str) -> Dict:
    query = gql('''
        query poapTransfers(
            $startSec: BigInt!,
            $endSec: BigInt!,
            $skip: Int!,
            $first: Int!
        ) {
            transfers(
                first: $first,
                where: { timestamp_gte: $startSec, timestamp_lte: $endSec },
                orderBy: timestamp,
                orderDirection: desc,
                subgraphError: deny,
                skip: $skip
            ) {
                from {
                    id
                }
                to {
                    id
                }
                token {
                    event {
                        id
                    }
                }
            }
        }
    ''')

    stats = {
        "transfers": [],
        "minted": [],
        "unique_events": set(),
        "event_transfers": defaultdict(lambda: 0),
    }
    for i in range(24):
        skip = 0
        start_sec = yesterday_sec + (i * SECONDS_PER_HOUR)
        print(f"  Fetching from {datetime.utcfromtimestamp(start_sec)}")
        while True:
            print(f"    Fetch offset {skip}")
            variable_values = {
                "startSec": start_sec,
                "endSec": start_sec + SECONDS_PER_HOUR,
                "skip": skip,
                "first": FIRST_TO_FETCH
            }
            data = _execute_gql(query, url, variable_values)
            transfers = data["transfers"]
            for transfer in transfers:
                from_id = transfer["from"]["id"]
                to_id = transfer["to"]["id"]
                event_id = transfer["token"]["event"]["id"]
                stats["transfers"].append(to_id)
                if from_id == ZERO_ADDRESS:
                    stats["minted"].append(to_id)
                stats["unique_events"].add(event_id)
                stats["event_transfers"][event_id] += 1

            skip += len(transfers)
            if len(transfers) < FIRST_TO_FETCH:
                break

    return stats


def _send_tweets(tweets: List[str]) -> tweepy.API:
    # Fetch credentials
    consumer_key = os.getenv("CONSUMER_KEY")
    consumer_secret = os.getenv("CONSUMER_SECRET")
    access_token = os.getenv("ACCESS_TOKEN")
    access_token_secret = os.getenv("ACCESS_TOKEN_SECRET")

    # Authenticate
    auth = tweepy.OAuthHandler(consumer_key, consumer_secret)
    auth.set_access_token(access_token, access_token_secret)
    api = tweepy.API(auth)
    for tweet in tweets:
        api.update_status(tweet)


def _tweet_network_stats() -> None:
    yesterday, start_sec = _get_yesterday_unix_timestamp_utc()
    date = yesterday.strftime("%b %-d, %Y")
    print(f"Start time from yesterday: {yesterday}, unix time {start_sec}")

    print("Fetching mainnet data...")
    mainnet_stats = _fetch_subgraph_stats(start_sec, SUBGRAPH_MAINNET_URL)
    mainnet_msg = TWEET_MSG.format(
        network="Mainnet",
        date=date,
        total_transfers=len(mainnet_stats["transfers"]),
        minted=len(mainnet_stats["minted"]),
        events=len(mainnet_stats["unique_events"]),
        leaderboard=_event_leaderboard(mainnet_stats["event_transfers"])
    )
    print(f"Mainnet tweet: {mainnet_msg}")
    _send_tweets([mainnet_msg])


def lambda_handler(event, context):
    """Entrypoint for deploying to AWS Lambda"""
    _tweet_network_stats()
    return
