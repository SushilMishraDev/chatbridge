import os
import secrets
import smtplib
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from fastapi import APIRouter, Depends, HTTPException
import httpx
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Conversation, User
from ..schemas import Credentials, GoogleAuthIn, RequestOtpIn, VerifyOtpIn
from ..security import get_current_user, hash_password, make_token, verify_password
from ..services.seed_data import seed_chats_for_user

router = APIRouter()

otp_cache: dict[str, dict] = {}


def send_email_otp(to_email: str, code: str) -> bool:
    smtp_host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.environ.get("SMTP_PORT", 587))
    smtp_user = os.environ.get("SMTP_USER", "").strip()
    smtp_password = os.environ.get("SMTP_PASSWORD", "").replace(" ", "").strip()

    if not smtp_user or not smtp_password:
        print(f"\n==========================================")
        print(f"[SECURITY] OTP generated for: {to_email}")
        print(f"[SECURITY] 6-digit verification code: {code}")
        print(f"[SECURITY] Connect SMTP in .env to deliver real emails to inbox.")
        print(f"==========================================\n")
        return False

    msg = MIMEMultipart()
    msg["From"] = f"ChatBridge <{smtp_user}>"
    msg["To"] = to_email
    msg["Subject"] = f"{code} is your ChatBridge verification code"

    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e0d8; border-radius: 12px; background: #ffffff;">
      <h2 style="color: #1c1915; margin: 0 0 12px; font-family: Georgia, serif;">ChatBridge Verification Code</h2>
      <p style="color: #555; font-size: 14px; margin: 0 0 20px;">Use the following 6-digit code to complete your sign-in. This code will expire in 10 minutes.</p>
      <div style="background: #f7f5f0; border-radius: 8px; padding: 18px; text-align: center; margin: 0 0 20px;">
        <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #c45c26;">{code}</span>
      </div>
      <p style="color: #888; font-size: 12px; margin: 0;">If you didn't request this code, you can safely ignore this email.</p>
    </div>
    """
    msg.attach(MIMEText(html, "html"))

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
            server.starttls()
            server.login(smtp_user, smtp_password)
            server.sendmail(smtp_user, to_email, msg.as_string())
        print(f"[AUTH OTP] Real email OTP successfully delivered to {to_email}!")
        return True
    except Exception as e:
        print(f"[AUTH OTP] Failed to send email via SMTP: {e}")
        return False


@router.post("/auth/request-otp")
def request_otp(body: RequestOtpIn):
    email = body.email.strip().lower()
    code = f"{secrets.randbelow(900000) + 100000}"
    otp_cache[email] = {
        "code": code,
        "expires_at": time.time() + 600,
    }
    # Deliver real email via SMTP
    send_email_otp(email, code)

    # Return clean confirmation — NEVER leak the code in client response!
    return {
        "ok": True,
        "message": f"Verification code sent to {email}",
    }


@router.post("/auth/verify-otp")
def verify_otp(body: VerifyOtpIn, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    record = otp_cache.get(email)
    if not record or record["expires_at"] < time.time():
        raise HTTPException(400, "Verification code has expired or is invalid. Please request a new code.")
    if record["code"] != body.code.strip():
        raise HTTPException(400, "Incorrect 6-digit verification code. Please check and try again.")

    otp_cache.pop(email, None)

    user = db.query(User).filter_by(email=email).first()
    if not user:
        random_pw = secrets.token_urlsafe(32)
        user = User(email=email, password_hash=hash_password(random_pw))
        db.add(user)
        db.commit()
        seed_chats_for_user(db, user.id)
    else:
        has_chats = db.query(Conversation).filter_by(user_id=user.id).first() is not None
        if not has_chats:
            seed_chats_for_user(db, user.id)

    return {"token": make_token(user.id), "email": user.email}


@router.post("/register")
def register(body: Credentials, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if "@" not in email or "." not in email:
        raise HTTPException(400, "Please enter a valid email address.")
    if len(body.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters.")

    existing = db.query(User).filter_by(email=email).first()
    if existing:
        raise HTTPException(400, "An account with this email already exists. Please Sign In.")

    user = User(email=email, password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    seed_chats_for_user(db, user.id)
    return {"token": make_token(user.id), "email": user.email}


@router.post("/login")
def login(body: Credentials, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if "@" not in email or "." not in email:
        raise HTTPException(400, "Please enter a valid email address.")
    if not body.password:
        raise HTTPException(400, "Please enter your password.")

    user = db.query(User).filter_by(email=email).first()
    if user is None:
        raise HTTPException(
            404,
            "No account found with this email. Please check your email or click Create Account to register.",
        )

    if not verify_password(body.password, user.password_hash):
        raise HTTPException(
            401,
            "Incorrect password. Please enter the correct password for this account.",
        )

    # Ensure sample history is available if user has no chats
    has_chats = db.query(Conversation).filter_by(user_id=user.id).first() is not None
    if not has_chats:
        seed_chats_for_user(db, user.id)

    return {"token": make_token(user.id), "email": user.email}


@router.post("/auth/google")
async def auth_google(body: GoogleAuthIn, db: Session = Depends(get_db)):
    email = None

    # Support dev/fallback sign-in without external internet dependency
    if body.credential == "dev-mode" and body.dev_email:
        email = body.dev_email.strip().lower()
        if "@" not in email or "." not in email:
            raise HTTPException(400, "Please enter a valid email address")
    else:
        # Verify official Google ID token via Google's tokeninfo API
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(
                    "https://oauth2.googleapis.com/tokeninfo",
                    params={"id_token": body.credential},
                    timeout=10.0,
                )
            except Exception as e:
                raise HTTPException(400, f"Could not verify with Google: {e}")

        if resp.status_code != 200:
            raise HTTPException(401, "Invalid Google credential token")

        data = resp.json()
        email = (data.get("email") or "").strip().lower()
        if not email:
            raise HTTPException(400, "Google account does not contain a verified email")

        google_client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
        if google_client_id and data.get("aud") != google_client_id:
            raise HTTPException(401, "Google client ID mismatch")

    user = db.query(User).filter_by(email=email).first()
    if not user:
        random_pw = secrets.token_urlsafe(32)
        user = User(email=email, password_hash=hash_password(random_pw))
        db.add(user)
        db.commit()
        seed_chats_for_user(db, user.id)
    else:
        # Ensure user has sample chats if empty
        has_chats = db.query(Conversation).filter_by(user_id=user.id).first() is not None
        if not has_chats:
            seed_chats_for_user(db, user.id)

    return {"token": make_token(user.id), "email": user.email}


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "email": user.email}
