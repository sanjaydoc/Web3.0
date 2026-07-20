"""Adapters put existing agents/models on Web3.0 — tested hermetically with a local mock server."""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from web3_sdk.adapters import CallableAdapter, HttpAdapter, OpenAIChatAdapter


def _serve(handler_fn):
    """Spin up a throwaway HTTP server that runs handler_fn(path, body) -> dict."""

    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            out = handler_fn(self.path, body)
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(out).encode())

        def log_message(self, *a):  # keep tests quiet
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"


def test_callable_adapter_wraps_a_function():
    a = CallableAdapter(lambda q: f"you said: {q}")
    assert a.reply({"question": "hi"}) == {"answer": "you said: hi"}
    # accepts prompt/text aliases too
    assert a.reply({"prompt": "yo"}) == {"answer": "you said: yo"}


def test_http_adapter_forwards_to_an_existing_endpoint():
    seen = {}

    def handler(path, body):
        seen["input"] = body["input"]
        return {"answer": f"echo: {body['input']['question']}"}

    srv, url = _serve(handler)
    try:
        a = HttpAdapter(url + "/agent")
        assert a.reply({"question": "ping"}) == {"answer": "echo: ping"}
        assert seen["input"] == {"question": "ping"}
    finally:
        srv.shutdown()


def test_openai_chat_adapter_calls_chat_completions():
    def handler(path, body):
        assert path.endswith("/chat/completions")
        assert body["model"] == "test-model"
        # last user message echoes back
        user = [m for m in body["messages"] if m["role"] == "user"][-1]["content"]
        return {"choices": [{"message": {"role": "assistant", "content": f"A: {user}"}}]}

    srv, url = _serve(handler)
    try:
        a = OpenAIChatAdapter(base_url=url + "/v1", model="test-model", system="be brief")
        assert a.reply({"question": "what is Web3.0?"}) == {"answer": "A: what is Web3.0?"}
    finally:
        srv.shutdown()
