from urllib.parse import urlencode


def build_bot_authorize_url(
    server_host: str,
    client_id: str,
    scopes: list[str],
    permissions: int,
) -> str:
    query = urlencode({
        "client_id": client_id,
        "scope": " ".join(scopes),
        "permissions": permissions,
    })
    return f"{server_host.rstrip('/')}/bot/authorize?{query}"
