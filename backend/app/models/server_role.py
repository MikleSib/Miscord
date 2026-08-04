from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean, BigInteger, UniqueConstraint
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.database import Base


class Role(Base):
    """Роль сервера с набором прав в виде битовой маски."""

    __tablename__ = "server_roles"

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey("channels.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    color = Column(String, nullable=True)  # HEX, например "#5865f2"
    position = Column(Integer, default=0, nullable=False)
    permissions = Column(BigInteger, default=0, nullable=False)
    is_default = Column(Boolean, default=False, nullable=False)  # роль @everyone
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    server = relationship("Channel", back_populates="roles")
    member_links = relationship("MemberRole", back_populates="role", cascade="all, delete-orphan")


class MemberRole(Base):
    """Связь участника сервера с ролью."""

    __tablename__ = "server_member_roles"
    __table_args__ = (UniqueConstraint("role_id", "user_id", name="uq_member_role"),)

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey("channels.id"), nullable=False, index=True)
    role_id = Column(Integer, ForeignKey("server_roles.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    assigned_at = Column(DateTime(timezone=True), server_default=func.now())

    role = relationship("Role", back_populates="member_links")
    user = relationship("User")
