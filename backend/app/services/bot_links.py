from urllib.parse import urlencode


def build_bot_authorize_url(
    server_host: str,
    client_id: str,
    scopes: list[str] | None = None,
    permissions: int | None = None,
    *,
    guild_id: int | str | None = None,
    disable_guild_select: bool = False,
    integration_type: int | None = None,
) -> str:
    params: dict[str, str | int] = {"client_id": client_id}
    if scopes is not None:
        params["scope"] = " ".join(scopes)
    if permissions is not None:
        params["permissions"] = permissions
    if guild_id is not None:
        params["guild_id"] = str(guild_id)
    if disable_guild_select:
        params["disable_guild_select"] = "true"
    if integration_type is not None:
        params["integration_type"] = integration_type
    query = urlencode(params)
    return f"{server_host.rstrip('/')}/oauth2/authorize?{query}"
