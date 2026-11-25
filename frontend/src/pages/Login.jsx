import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  "712838038064-ena058v1pbhfgbhjjn32c43h0m5g9pea.apps.googleusercontent.com";

export default function Login() {
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [step, setStep] = useState("email"); // "email" or "code"
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    function initGoogle() {
      if (window.google?.accounts?.id) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleResponse,
          auto_select: false,
        });

        const container = document.getElementById("google-signin-btn");
        if (container) {
          container.innerHTML = "";
          window.google.accounts.id.renderButton(container, {
            theme: "outline",
            size: "large",
            width: 364,
            text: "continue_with",
            shape: "rectangular",
          });
        }
      } else {
        setTimeout(initGoogle, 300);
      }
    }
    initGoogle();
  }, []);

  async function handleGoogleResponse(response) {
    if (!response || !response.credential) return;
    setLoading(true);
    setError("");
    try {
      const out = await api("/auth/google", {
        method: "POST",
        body: JSON.stringify({ credential: response.credential }),
      });
      localStorage.setItem("token", out.token);
      try {
        window.dispatchEvent(new CustomEvent("chatbridge:trigger-auto-collect"));
        window.postMessage({ type: "CHATBRIDGE_TRIGGER_AUTO_COLLECT" }, "*");
      } catch {}
      nav("/");
    } catch (err) {
      setError(String(err.message || "Google Sign-In failed."));
    } finally {
      setLoading(false);
    }
  }

  async function handleSendOtp(e) {
    e.preventDefault();
    setError("");

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@") || !cleanEmail.includes(".")) {
      setError("Please enter a valid email address (e.g. name@yahoo.com or name@outlook.com).");
      return;
    }

    setLoading(true);
    try {
      await api("/auth/request-otp", {
        method: "POST",
        body: JSON.stringify({ email: cleanEmail }),
      });
      setOtpCode("");
      setStep("code");
    } catch (err) {
      setError(String(err.message || "Could not send verification code."));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e) {
    e.preventDefault();
    setError("");

    if (!otpCode || otpCode.trim().length !== 6) {
      setError("Please enter the 6-digit verification code.");
      return;
    }

    setLoading(true);
    try {
      const out = await api("/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          code: otpCode.trim(),
        }),
      });
      localStorage.setItem("token", out.token);
      try {
        window.dispatchEvent(new CustomEvent("chatbridge:trigger-auto-collect"));
        window.postMessage({ type: "CHATBRIDGE_TRIGGER_AUTO_COLLECT" }, "*");
      } catch {}
      nav("/");
    } catch (err) {
      setError(String(err.message || "Invalid verification code."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand">
          <span className="wordmark">ChatBridge</span>
          <span className="tag">continue a chat on another AI</span>
        </div>
      </div>

      <div className="hero">
        <div className="hero-copy">
          <h2>Keep your conversation moving when one AI hits its limit.</h2>
          <p>
            ChatBridge saves your conversations from ChatGPT, Claude, and Gemini, then builds a
            seamless handoff prompt so you can continue where you left off on another assistant.
          </p>
          <div className="points">
            <div className="point">
              <b>⚡ Scan & Capture Conversations</b>
              The Chrome extension scans your past conversations directly from the sidebar and auto-syncs new messages.
            </div>
            <div className="point">
              <b>🔒 100% Passwordless Sign-In</b>
              Sign in with your real Google account or email verification. No password creation required.
            </div>
            <div className="point">
              <b>🔄 One-Click Handoff</b>
              Generate an intelligent context prompt, open Claude or Gemini, and continue without retyping.
            </div>
          </div>
        </div>

        <div className="card stack" style={{ maxWidth: "420px", width: "100%", padding: "28px" }}>
          {/* Header */}
          <div style={{ marginBottom: "18px" }}>
            <h3 style={{ margin: "0 0 6px", fontSize: "22px", fontFamily: "Fraunces, Georgia, serif" }}>
              Sign In to ChatBridge
            </h3>
            <p className="meta" style={{ margin: 0, fontSize: "13px" }}>
              Fast, secure sign-in. No passwords to remember.
            </p>
          </div>

          {/* Official Google Sign In */}
          <div style={{ marginBottom: "4px" }}>
            <div
              id="google-signin-btn"
              style={{
                minHeight: "44px",
                width: "100%",
                display: "flex",
                justifyContent: "center",
              }}
            ></div>
          </div>

          {/* Divider */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              margin: "18px 0 14px",
              color: "var(--muted)",
              fontSize: "12px",
            }}
          >
            <div style={{ flex: 1, height: "1px", background: "var(--line, #e5e0d8)" }}></div>
            <span>or sign in with Yahoo, Outlook, etc.</span>
            <div style={{ flex: 1, height: "1px", background: "var(--line, #e5e0d8)" }}></div>
          </div>

          {/* Error Alert */}
          {error && (
            <div
              style={{
                background: "rgba(180, 35, 24, 0.08)",
                border: "1px solid rgba(180, 35, 24, 0.3)",
                color: "#b42318",
                padding: "10px 14px",
                borderRadius: "8px",
                fontSize: "13px",
                lineHeight: "1.4",
                marginBottom: "14px",
              }}
            >
              ⚠️ {error}
            </div>
          )}

          {/* Email Verification Form (No Passwords!) */}
          {step === "email" ? (
            <form onSubmit={handleSendOtp} className="stack" style={{ gap: "12px" }}>
              <div>
                <label
                  htmlFor="user-email"
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "var(--muted)",
                    display: "block",
                    marginBottom: "5px",
                  }}
                >
                  Email Address
                </label>
                <input
                  id="user-email"
                  type="email"
                  required
                  placeholder="yourname@yahoo.com or outlook.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    fontSize: "14px",
                    borderRadius: "8px",
                    border: "1px solid var(--line, #d5cebf)",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <button
                className="btn"
                type="submit"
                disabled={loading}
                style={{
                  width: "100%",
                  padding: "11px",
                  fontSize: "14px",
                  fontWeight: 600,
                  marginTop: "2px",
                  cursor: loading ? "wait" : "pointer",
                }}
              >
                {loading ? "Sending..." : "Send Verification Code"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="stack" style={{ gap: "12px" }}>
              <div
                style={{
                  background: "rgba(47, 93, 80, 0.08)",
                  border: "1px solid rgba(47, 93, 80, 0.25)",
                  borderRadius: "8px",
                  padding: "12px 14px",
                  fontSize: "13px",
                  color: "#1c1915",
                  lineHeight: "1.4",
                }}
              >
                ✉️ We sent a secure 6-digit verification code to <b>{email}</b>. Please check your inbox (or spam folder) and enter it below.
              </div>

              <div>
                <label
                  htmlFor="otp-code"
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "var(--muted)",
                    display: "block",
                    marginBottom: "5px",
                  }}
                >
                  Enter 6-digit code
                </label>
                <input
                  id="otp-code"
                  type="text"
                  required
                  maxLength={6}
                  placeholder="123456"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    fontSize: "18px",
                    textAlign: "center",
                    letterSpacing: "4px",
                    fontWeight: 600,
                    borderRadius: "8px",
                    border: "1px solid var(--line, #d5cebf)",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <button
                className="btn"
                type="submit"
                disabled={loading}
                style={{
                  width: "100%",
                  padding: "11px",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: loading ? "wait" : "pointer",
                }}
              >
                {loading ? "Verifying..." : "Verify & Sign In"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setError("");
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--muted)",
                  fontSize: "12px",
                  cursor: "pointer",
                  textAlign: "center",
                  padding: "4px",
                }}
              >
                ← Use a different email
              </button>
            </form>
          )}

          <p
            className="meta"
            style={{
              fontSize: "11px",
              textAlign: "center",
              marginTop: "16px",
              marginBottom: 0,
              lineHeight: 1.5,
              color: "var(--muted)",
            }}
          >
            🔒 ChatBridge uses passwordless verification. You never need to create or store a password.
          </p>
        </div>
      </div>
    </div>
  );
}
