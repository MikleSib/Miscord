from __future__ import annotations

from pydantic import BaseModel, Field, field_validator, model_validator

POLL_DURATIONS_SECONDS = {3600, 14400, 28800, 86400, 259200, 604800}


class PollAnswerCreate(BaseModel):
    text: str = Field(min_length=1, max_length=200)
    emoji: str | None = Field(default=None, max_length=128)

    @field_validator("text")
    @classmethod
    def strip_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Вариант ответа не может быть пустым")
        return value


class PollCreate(BaseModel):
    question: str = Field(min_length=1, max_length=300)
    answers: list[PollAnswerCreate] = Field(min_length=2, max_length=10)
    allow_multiselect: bool = False
    duration_seconds: int = 86400

    @field_validator("question")
    @classmethod
    def strip_question(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Вопрос не может быть пустым")
        return value

    @field_validator("duration_seconds")
    @classmethod
    def validate_duration(cls, value: int) -> int:
        if value not in POLL_DURATIONS_SECONDS:
            raise ValueError("Недопустимая длительность опроса")
        return value

    @model_validator(mode="after")
    def validate_unique_answers(self):
        normalized = [answer.text.casefold() for answer in self.answers]
        if len(normalized) != len(set(normalized)):
            raise ValueError("Варианты ответа не должны повторяться")
        return self
