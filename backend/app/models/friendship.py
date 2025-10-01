import enum
from sqlalchemy import Column, Integer, ForeignKey, Enum
from sqlalchemy.orm import relationship
from app.db.database import Base

class FriendshipStatus(enum.Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    BLOCKED = "blocked"

class Friendship(Base):
    __tablename__ = "friendships"

    id = Column(Integer, primary_key=True, index=True)
    user_a_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    user_b_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(Enum(FriendshipStatus), nullable=False, default=FriendshipStatus.PENDING)

    user_a = relationship("User", foreign_keys=[user_a_id], back_populates="friendships_a")
    user_b = relationship("User", foreign_keys=[user_b_id], back_populates="friendships_b")
