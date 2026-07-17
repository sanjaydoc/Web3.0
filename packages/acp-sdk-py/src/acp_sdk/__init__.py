"""acp-sdk — build agents for the ACP agentic internet.

from acp_sdk import Agent

alice = Agent("alice", name="Alice")
alice.register()
alice.connect()
alice.submit_task("bob@web3.0", "summarise", {"text": "..."})
"""

from . import crypto
from .agent import Agent
from .http import HttpError

__all__ = ["Agent", "HttpError", "crypto"]
__version__ = "0.1.0"
