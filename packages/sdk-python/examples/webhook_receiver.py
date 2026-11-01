"""A minimal run-status webhook receiver (standard library). Set TRIBUTARY_WEBHOOK_SECRET to the whsec_... value."""

import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

from tributary_sdk import verify_webhook

SECRET = os.environ["TRIBUTARY_WEBHOOK_SECRET"]


class Receiver(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802
        body = self.rfile.read(int(self.headers["content-length"]))
        if not verify_webhook(SECRET, self.headers.get("x-tributary-signature", ""), body):
            self.send_response(401)
            self.end_headers()
            return
        event = json.loads(body)
        print(event["event"], event["data"])
        self.send_response(204)
        self.end_headers()


HTTPServer(("0.0.0.0", 8787), Receiver).serve_forever()  # noqa: S104
