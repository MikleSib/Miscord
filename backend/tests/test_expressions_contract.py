from pathlib import Path

import pytest
from PIL import Image
from pydantic import ValidationError

from app.schemas.expressions import ExpressionCreate, ExpressionUpdate
from app.services.expression_media import InvalidExpressionMedia, _inspect_image


def test_expression_names_are_normalized_for_create_and_update() -> None:
    created = ExpressionCreate(kind="emoji", name=" Party Parrot ", upload_id="upload-123")
    updated = ExpressionUpdate(name=" New Name ")
    assert created.name == "party_parrot"
    assert updated.name == "new_name"
    with pytest.raises(ValidationError):
        ExpressionUpdate(name="bad/name")


def test_expression_image_uses_verified_dimensions(tmp_path: Path) -> None:
    source = tmp_path / "emoji.png"
    Image.new("RGBA", (128, 96), (255, 0, 0, 255)).save(source)
    info = _inspect_image(source, kind="emoji")
    assert (info.width, info.height, info.animated) == (128, 96, False)


def test_expression_rejects_corrupt_image(tmp_path: Path) -> None:
    source = tmp_path / "broken.png"
    source.write_bytes(b"not-an-image")
    with pytest.raises(InvalidExpressionMedia):
        _inspect_image(source, kind="sticker")
