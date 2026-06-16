"""Minimal mock OIDC IdP for the FR-AUTH-013 success-path test.

Run as a standalone server inside the backend container (it is NOT imported):

    docker exec -d wiki-backend-1 python /app/tests/mock_idp.py    # serves :9990

Serves the three endpoints the backend's OIDC flow needs:
  - GET  /.well-known/openid-configuration  → discovery
  - GET  /jwks                              → the RS256 public key
  - POST /token                             → a signed id_token

The id_token carries a FIXED nonce + email so the test can mint a matching state
cookie (the mock can't know the per-request nonce). Keep these in sync with the
`MOCK_NONCE` / `MOCK_EMAIL` constants in `test_oidc_callback.py`.
"""
import http.server
import json
import socketserver
import time

from authlib.jose import JsonWebKey, jwt as ajwt

ISSUER = "http://localhost:9990"
KID = "test-key-1"
NONCE = "fixed-test-nonce-abc"
EMAIL = "oidc-success@example.com"
CLIENT_ID = "test-client"

_key = JsonWebKey.generate_key("RSA", 2048, is_private=True)
_pub = _key.as_dict(is_private=False)
_pub["kid"] = KID
JWKS = {"keys": [_pub]}
DISCOVERY = {
    "issuer": ISSUER,
    "authorization_endpoint": ISSUER + "/authorize",
    "token_endpoint": ISSUER + "/token",
    "jwks_uri": ISSUER + "/jwks",
}


def _id_token() -> str:
    now = int(time.time())
    return ajwt.encode(
        {"alg": "RS256", "kid": KID},
        {"iss": ISSUER, "aud": CLIENT_ID, "exp": now + 3600, "iat": now,
         "sub": "user-1", "email": EMAIL, "name": "OIDC User", "nonce": NONCE},
        _key,
    ).decode()


class _Handler(http.server.BaseHTTPRequestHandler):
    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/.well-known/openid-configuration"):
            self._json(DISCOVERY)
        elif self.path.startswith("/jwks"):
            self._json(JWKS)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("content-length", 0))
        self.rfile.read(length)
        if self.path.startswith("/token"):
            self._json({"id_token": _id_token(), "access_token": "a", "token_type": "Bearer"})
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, *args):  # silence
        pass


if __name__ == "__main__":
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    socketserver.ThreadingTCPServer(("0.0.0.0", 9990), _Handler).serve_forever()
