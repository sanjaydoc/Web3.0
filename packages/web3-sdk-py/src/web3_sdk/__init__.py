"""web3-sdk — build agents for the Web3.0 agentic internet.

from web3_sdk import Agent

alice = Agent("alice", name="Alice")
alice.register()
alice.connect()
alice.submit_task("bob@web3.0", "summarise", {"text": "..."})
"""

from . import crypto
from .adapters import Adapter, CallableAdapter, HttpAdapter, OpenAIChatAdapter, serve
from .agent import Agent
from .config import load_env
from .host import AgentHost
from .http import HttpError
from .llm import LLM, LLMError

__all__ = [
    "LLM",
    "Adapter",
    "Agent",
    "AgentHost",
    "CallableAdapter",
    "HttpAdapter",
    "HttpError",
    "LLMError",
    "OpenAIChatAdapter",
    "crypto",
    "load_env",
    "serve",
]
__version__ = "0.1.0"
