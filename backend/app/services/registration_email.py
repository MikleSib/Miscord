from __future__ import annotations

import asyncio
import html
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

from app.core.config import settings


class MailDeliveryError(RuntimeError):
    pass


def render_verification_email(code: str, expires_minutes: int) -> tuple[str, str]:
    safe_code = html.escape(code)
    text = (
        "Подтвердите регистрацию в Miscord\n\n"
        f"Код подтверждения: {code}\n"
        f"Он действует {expires_minutes} минут.\n\n"
        "Если вы не создавали аккаунт, просто проигнорируйте это письмо.\n"
        f"Поддержка: {settings.MAIL_SUPPORT_ADDRESS}"
    )
    document = f"""<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#17181c;color:#f4f5f7;font-family:Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#17181c">
    <tr><td align="center" style="padding:32px 14px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
             style="max-width:560px;background:#25262c;border:1px solid #393b44;border-radius:18px;overflow:hidden">
        <tr><td style="padding:28px 32px 18px">
          <div style="font-size:15px;font-weight:700;color:#7c86ff;letter-spacing:.02em">MISCORD</div>
          <h1 style="margin:18px 0 10px;font-size:28px;line-height:1.2;color:#fff">Подтвердите вашу почту</h1>
          <p style="margin:0;color:#b6b8c2;font-size:16px;line-height:1.55">
            Введите этот код на странице регистрации. Он действует {expires_minutes} минут.
          </p>
        </td></tr>
        <tr><td align="center" style="padding:16px 32px 26px">
          <div style="display:inline-block;padding:18px 24px;border-radius:14px;background:#1b1c21;
                      border:1px solid #4e5270;font-size:34px;font-weight:800;letter-spacing:10px;color:#fff">
            {safe_code}
          </div>
        </td></tr>
        <tr><td style="padding:0 32px 30px;color:#8f929e;font-size:13px;line-height:1.55">
          Никому не сообщайте код. Если вы не создавали аккаунт, письмо можно проигнорировать.
          Нужна помощь? <a href="mailto:{settings.MAIL_SUPPORT_ADDRESS}"
          style="color:#8e96ff;text-decoration:none">Напишите в поддержку</a>.
        </td></tr>
      </table>
      <p style="margin:18px 0 0;color:#6f727d;font-size:12px">Miscord · общение без лишнего шума</p>
    </td></tr>
  </table>
</body>
</html>"""
    return text, document


def render_welcome_email(display_name: str) -> tuple[str, str]:
    safe_name = html.escape(display_name)
    text = (
        f"Добро пожаловать в Miscord, {display_name}!\n\n"
        "Ваш аккаунт готов. Создайте сервер или присоединитесь к друзьям.\n\n"
        f"Поддержка: {settings.MAIL_SUPPORT_ADDRESS}\n"
        f"Для команд и партнёров: {settings.MAIL_SALES_ADDRESS}"
    )
    document = f"""<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#17181c;color:#f4f5f7;font-family:Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#17181c">
    <tr><td align="center" style="padding:32px 14px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
             style="max-width:560px;background:#25262c;border:1px solid #393b44;border-radius:18px">
        <tr><td style="padding:34px 32px">
          <div style="font-size:15px;font-weight:700;color:#7c86ff;letter-spacing:.02em">MISCORD</div>
          <h1 style="margin:18px 0 12px;font-size:28px;line-height:1.2;color:#fff">
            Добро пожаловать, {safe_name}!
          </h1>
          <p style="margin:0 0 24px;color:#b6b8c2;font-size:16px;line-height:1.55">
            Почта подтверждена, аккаунт готов. Создайте своё пространство или присоединитесь к друзьям.
          </p>
          <a href="{settings.SERVER_HOST}" style="display:inline-block;background:#5865f2;color:#fff;
             text-decoration:none;font-size:15px;font-weight:700;padding:13px 20px;border-radius:10px">
            Открыть Miscord
          </a>
          <p style="margin:28px 0 0;color:#8f929e;font-size:13px;line-height:1.6">
            Нужна помощь? <a href="mailto:{settings.MAIL_SUPPORT_ADDRESS}"
            style="color:#8e96ff;text-decoration:none">Поддержка</a> ·
            Для команд: <a href="mailto:{settings.MAIL_SALES_ADDRESS}"
            style="color:#8e96ff;text-decoration:none">Отдел продаж</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""
    return text, document


class RegistrationMailer:
    async def send_code(self, recipient: str, code: str, expires_minutes: int) -> None:
        await asyncio.to_thread(self._send_code_sync, recipient, code, expires_minutes)

    async def send_welcome(self, recipient: str, display_name: str) -> None:
        text, document = render_welcome_email(display_name)
        await asyncio.to_thread(
            self._send_message_sync,
            recipient,
            "Добро пожаловать в Miscord",
            text,
            document,
        )

    def _send_code_sync(self, recipient: str, code: str, expires_minutes: int) -> None:
        if not settings.SMTP_HOST:
            raise MailDeliveryError("SMTP is not configured")
        text, document = render_verification_email(code, expires_minutes)
        self._send_message_sync(recipient, "Подтвердите почту в Miscord", text, document)

    def _send_message_sync(self, recipient: str, subject: str, text: str, document: str) -> None:
        if not settings.SMTP_HOST:
            raise MailDeliveryError("SMTP is not configured")
        message = EmailMessage()
        message["Subject"] = subject
        message["From"] = formataddr((settings.MAIL_FROM_NAME, settings.MAIL_FROM_ADDRESS))
        message["To"] = recipient
        message["Reply-To"] = settings.MAIL_SUPPORT_ADDRESS
        message.set_content(text)
        message.add_alternative(document, subtype="html")

        try:
            if settings.SMTP_SECURITY == "ssl":
                client: smtplib.SMTP = smtplib.SMTP_SSL(
                    settings.SMTP_HOST,
                    settings.SMTP_PORT,
                    timeout=settings.SMTP_TIMEOUT_SECONDS,
                    context=ssl.create_default_context(),
                )
            else:
                client = smtplib.SMTP(
                    settings.SMTP_HOST,
                    settings.SMTP_PORT,
                    timeout=settings.SMTP_TIMEOUT_SECONDS,
                )
            with client:
                if settings.SMTP_SECURITY == "starttls":
                    client.starttls(context=ssl.create_default_context())
                if settings.SMTP_USERNAME:
                    client.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
                client.send_message(message)
        except (OSError, smtplib.SMTPException) as exc:
            raise MailDeliveryError("Verification email could not be delivered") from exc


registration_mailer = RegistrationMailer()
