from pydantic import BaseModel, Field


class E2eeDeviceRegister(BaseModel):
    device_id: str = Field(min_length=36, max_length=36)
    credential_id: str = Field(min_length=3, max_length=192)
    key_package: str = Field(min_length=16, max_length=32768)
    signature_public_key: str = Field(min_length=16, max_length=1024)


class E2eeDeviceResponse(BaseModel):
    device_id: str
    credential_id: str
    key_package: str
    key_package_id: str
    signature_public_key: str


class SecretDmSessionCreate(BaseModel):
    session_id: str = Field(min_length=36, max_length=36)
    founder_device_id: str = Field(min_length=36, max_length=36)
    recipient_device_id: str = Field(min_length=36, max_length=36)
    recipient_key_package_id: str = Field(min_length=36, max_length=36)
    welcome: str = Field(min_length=16, max_length=350000)
    ratchet_tree: str = Field(min_length=16, max_length=1400000)


class SecretDmSessionResponse(BaseModel):
    session_id: str
    founder_user_id: int
    founder_device_id: str
    recipient_device_id: str
    welcome: str
    ratchet_tree: str
    local_device_id: str | None = None
    device_matches: bool


class SecretDmMessageResponse(BaseModel):
    id: int
    client_nonce: str | None = None
    timestamp: str
    sender_id: int
    recipient_id: int
    encryption_version: int
    ciphertext: str
    secret_session_id: str
    sender_device_id: str
