import json
from pathlib import Path
from urllib.parse import quote

import jwt
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import RedirectResponse, Response
from fastapi.templating import Jinja2Templates
from pydantic import ValidationError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..schemas import HandoffIn, PasteImportIn, RequestOtpIn, VerifyOtpIn
from ..security import ALGORITHM, SECRET
from . import auth as auth_routes
from . import chats as chat_routes
from . import export as export_routes
from . import handoff as handoff_routes
from . import imports as import_routes

router = APIRouter()
templates = Jinja2Templates(directory=str(Path(__file__).resolve().parents[1] / "templates"))
TOKEN_COOKIE = "chatbridge_token"
COOKIE_MAX_AGE = 7 * 24 * 60 * 60


def _render(request: Request, template: str, status_code: int = 200, **context):
    return templates.TemplateResponse(
        request=request,
        name=template,
        context={"request": request, **context},
        status_code=status_code,
    )


def _user_for_request(request: Request, db: Session) -> User | None:
    token = request.cookies.get(TOKEN_COOKIE)
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        return None
    return db.get(User, user_id)


def _login_page(
    request: Request,
    *,
    email: str = "",
    error: str | None = None,
    notice: str | None = None,
    show_code: bool = False,
    status_code: int = 200,
):
    return _render(
        request,
        "login.html",
        page_title="Sign in",
        email=email,
        error=error,
        notice=notice,
        show_code=show_code,
        status_code=status_code,
    )


def _set_login_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        TOKEN_COOKIE,
        token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="lax",
        path="/",
    )


@router.get("/login", include_in_schema=False)
def login_page(request: Request, db: Session = Depends(get_db)):
    if _user_for_request(request, db):
        return RedirectResponse("/ui", status_code=303)
    return _login_page(request)


@router.post("/ui/request-otp", include_in_schema=False)
def request_login_code(request: Request, email: str = Form(...)):
    try:
        body = RequestOtpIn(email=email)
        result = auth_routes.request_otp(body)
    except ValidationError:
        return _login_page(
            request,
            email=email,
            error="Enter a valid email address.",
            status_code=400,
        )
    except HTTPException as exc:
        return _login_page(
            request,
            email=email,
            error=str(exc.detail),
            status_code=exc.status_code,
        )
    return _login_page(
        request,
        email=body.email,
        notice=result["message"],
        show_code=True,
    )


@router.post("/ui/verify-otp", include_in_schema=False)
def verify_login_code(
    request: Request,
    email: str = Form(...),
    code: str = Form(...),
    db: Session = Depends(get_db),
):
    try:
        body = VerifyOtpIn(email=email, code=code)
        result = auth_routes.verify_otp(body, db)
    except ValidationError:
        return _login_page(
            request,
            email=email,
            error="Enter the email address and six-digit code.",
            show_code=True,
            status_code=400,
        )
    except HTTPException as exc:
        return _login_page(
            request,
            email=email,
            error=str(exc.detail),
            show_code=True,
            status_code=exc.status_code,
        )

    response = RedirectResponse("/ui", status_code=303)
    _set_login_cookie(response, request, result["token"])
    return response


@router.post("/ui/logout", include_in_schema=False)
def logout(request: Request):
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie(
        TOKEN_COOKIE,
        path="/",
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="lax",
    )
    return response


@router.get("/ui", include_in_schema=False)
def dashboard(
    request: Request,
    q: str = "",
    source: str = "all",
    sort: str = "newest",
    notice: str | None = None,
    db: Session = Depends(get_db),
):
    user = _user_for_request(request, db)
    if user is None:
        return RedirectResponse("/login", status_code=303)

    all_rows = chat_routes.list_chats(user, db)
    rows = all_rows
    if q.strip():
        query = q.strip().casefold()
        rows = [chat for chat in rows if query in chat["title"].casefold()]
    if source != "all":
        rows = [chat for chat in rows if chat["source"].casefold() == source.casefold()]

    sort_options = {
        "newest": (lambda chat: chat["updated_at"], True),
        "oldest": (lambda chat: chat["updated_at"], False),
        "messages": (lambda chat: chat["messages"], True),
        "title": (lambda chat: chat["title"].casefold(), False),
    }
    if sort not in sort_options:
        sort = "newest"
    sort_key, reverse = sort_options[sort]
    rows.sort(key=sort_key, reverse=reverse)

    return _render(
        request,
        "dashboard.html",
        page_title="Your chats",
        user_email=user.email,
        chats=rows,
        q=q,
        source=source,
        sort=sort,
        sources=sorted({chat["source"] for chat in all_rows}),
        notice=notice,
    )


@router.get("/ui/chats/{chat_id}", include_in_schema=False)
def chat_page(
    chat_id: int,
    request: Request,
    notice: str | None = None,
    db: Session = Depends(get_db),
):
    user = _user_for_request(request, db)
    if user is None:
        return RedirectResponse("/login", status_code=303)
    chat = chat_routes.get_chat(chat_id, user, db)
    return _render(
        request,
        "chat.html",
        page_title=chat["title"],
        user_email=user.email,
        chat=chat,
        notice=notice,
    )


@router.post("/ui/chats/{chat_id}/handoff", include_in_schema=False)
def create_handoff(
    chat_id: int,
    request: Request,
    target: str = Form(...),
    next_message: str = Form(""),
    db: Session = Depends(get_db),
):
    user = _user_for_request(request, db)
    if user is None:
        return RedirectResponse("/login", status_code=303)
    chat = chat_routes.get_chat(chat_id, user, db)
    try:
        result = handoff_routes.handoff(
            HandoffIn(
                conversation_id=chat_id,
                target=target,
                next_message=next_message.strip() or None,
            ),
            user,
            db,
        )
    except HTTPException as exc:
        return _render(
            request,
            "chat.html",
            page_title=chat["title"],
            user_email=user.email,
            chat=chat,
            error=str(exc.detail),
            status_code=exc.status_code,
        )
    return _render(
        request,
        "chat.html",
        page_title=chat["title"],
        user_email=user.email,
        chat=chat,
        handoff=result,
    )


@router.post("/ui/chats/{chat_id}/delete", include_in_schema=False)
def remove_chat(chat_id: int, request: Request, db: Session = Depends(get_db)):
    user = _user_for_request(request, db)
    if user is None:
        return RedirectResponse("/login", status_code=303)
    chat_routes.delete_chat(chat_id, user, db)
    return RedirectResponse("/ui?notice=Conversation+deleted", status_code=303)


@router.get("/ui/import", include_in_schema=False)
def import_page(
    request: Request,
    notice: str | None = None,
    error: str | None = None,
    status_code: int = 200,
    db: Session = Depends(get_db),
):
    user = _user_for_request(request, db)
    if user is None:
        return RedirectResponse("/login", status_code=303)
    return _render(
        request,
        "import.html",
        page_title="Import chats",
        user_email=user.email,
        notice=notice,
        error=error,
        status_code=status_code,
    )


@router.post("/ui/import/paste", include_in_schema=False)
def import_paste(
    request: Request,
    title: str = Form(...),
    source: str = Form("chatgpt"),
    content: str = Form(...),
    db: Session = Depends(get_db),
):
    user = _user_for_request(request, db)
    if user is None:
        return RedirectResponse("/login", status_code=303)
    try:
        body = PasteImportIn(title=title, source=source, content=content)
        result = import_routes.import_pasted(body, user, db)
    except ValidationError:
        return import_page(
            request,
            error="Enter a title and conversation text (up to 500,000 characters).",
            status_code=400,
            db=db,
        )
    except HTTPException as exc:
        return import_page(
            request,
            error=str(exc.detail),
            status_code=exc.status_code,
            db=db,
        )
    return RedirectResponse(
        f"/ui/import?notice={quote(result['info'])}",
        status_code=303,
    )


@router.post("/ui/import/file", include_in_schema=False)
async def import_file(
    request: Request,
    platform: str = Form(...),
    file: UploadFile = File(...),
    selected: list[str] = Form(default=[]),
    db: Session = Depends(get_db),
):
    user = _user_for_request(request, db)
    if user is None:
        return RedirectResponse("/login", status_code=303)
    if not selected:
        return import_page(
            request,
            error="Select at least one conversation to import.",
            status_code=400,
            db=db,
        )
    try:
        result = await import_routes.do_import(
            platform,
            file,
            json.dumps(selected),
            user,
            db,
        )
    except HTTPException as exc:
        return import_page(
            request,
            error=str(exc.detail),
            status_code=exc.status_code,
            db=db,
        )
    notice = f"Imported {result['imported']}; skipped {result['skipped']} already-saved chats."
    return RedirectResponse(
        f"/ui/import?notice={quote(notice)}",
        status_code=303,
    )


@router.post("/ui/import/preview", include_in_schema=False)
async def preview_import(
    request: Request,
    platform: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    user = _user_for_request(request, db)
    if user is None:
        return RedirectResponse("/login", status_code=303)
    try:
        items = await import_routes._items(platform, file)
    except HTTPException as exc:
        return import_page(
            request,
            error=str(exc.detail),
            status_code=exc.status_code,
            db=db,
        )
    return _render(
        request,
        "import_preview.html",
        page_title="Choose conversations",
        user_email=user.email,
        platform=platform,
        filename=file.filename or "export file",
        items=items,
    )


@router.get("/ui/export", include_in_schema=False)
def export_all_chats(request: Request, db: Session = Depends(get_db)):
    user = _user_for_request(request, db)
    if user is None:
        return RedirectResponse("/login", status_code=303)
    return export_routes.export_all(user, db)


@router.get("/ui/chats/{chat_id}/export", include_in_schema=False)
def export_one_chat(
    chat_id: int,
    request: Request,
    format: str = "md",
    db: Session = Depends(get_db),
):
    user = _user_for_request(request, db)
    if user is None:
        return RedirectResponse("/login", status_code=303)
    conversation = chat_routes.own_conversation(db, user, chat_id)
    content, media_type = export_routes.render(conversation, format)
    return export_routes.download(
        content,
        media_type,
        f"{export_routes.safe_name(conversation.title)}.{format}",
    )
