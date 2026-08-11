from pydantic import BaseModel, Field, field_validator

from app.schemas.user import UserCreate


class RegistrationStart(UserCreate):
    pass


class RegistrationChallengeResponse(BaseModel):
    challenge_id: str
    email_hint: str
    expires_in: int
    resend_in: int


class RegistrationVerify(BaseModel):
    challenge_id: str = Field(min_length=36, max_length=36)
    code: str = Field(min_length=6, max_length=6)

    @field_validator("code")
    @classmethod
    def code_is_six_digits(cls, value: str) -> str:
        if not value.isdigit():
            raise ValueError("Код должен состоять из шести цифр")
        return value


class RegistrationResend(BaseModel):
    challenge_id: str = Field(min_length=36, max_length=36)

