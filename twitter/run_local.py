import dotenv

from lambda_function import lambda_handler

dotenv.load_dotenv()

if __name__ == "__main__":
    lambda_handler(None, None)
