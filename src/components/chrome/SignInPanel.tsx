"use client";
import { useT } from "@/lib/i18n";

import "./chrome.css";
import "./library.css";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loginCommunityUser, registerCommunityUser } from "@/lib/community/client";
import { useCommunityUser } from "@/components/community/auth";
import { useDropdownDismiss } from "@/lib/hooks/use-dropdown-dismiss";
import { getUiScale } from "@/lib/ui-scale";
import { CHROME_SCREEN_K, type ChromeAnchor } from "./ChromeMenu";

/** The sign-in form, hung from the account key: sign in, or make an account (a name and a password, no email). */
export function SignInPanel({ anchor, onClose }: { anchor: ChromeAnchor; onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const { setUser } = useCommunityUser();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useDropdownDismiss(true, { refs: [ref], onClose, insideSelector: "[data-menu-anchor]" });
  // The panel wears the bar's extra zoom (chrome.css .mm, CHROME_SCREEN_K): its box is in those pixels.
  const scale = getUiScale() * CHROME_SCREEN_K;
  const vw = window.innerWidth / scale;

  const submit = async () => {
    if (busy || username.trim().length < 3 || password.length < 6) return;
    setBusy(true);
    setError(undefined);
    try {
      const signedIn =
        mode === "login"
          ? await loginCommunityUser(username, password)
          : await registerCommunityUser(username, password);
      setUser(signedIn);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={t("Sign in")}
      className="mm ml-signpanel ui-zoom"
      style={{
        top: anchor.bottom / scale + 2,
        right: Math.max(2, vw - (anchor.right ?? anchor.left) / scale),
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="ml-sign-title">
          {mode === "login" ? t("Sign in") : t("Create an account")}
        </div>
        <div className="ml-sign-sub">{t("Your plans are kept in your account")}</div>
        <label className="ml-sign-label">{t("USERNAME")}</label>
        <input
          autoFocus
          className="ml-search ml-sign-field"
          placeholder={t("Username")}
          autoComplete="username"
          maxLength={24}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
        <label className="ml-sign-label">{t("PASSWORD")}</label>
        <input
          className="ml-search ml-sign-field"
          type="password"
          placeholder={t("Password")}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          maxLength={128}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error ? <div className="ml-sign-error">{error}</div> : <div className="ml-sign-gap" />}
        <button
          className="ml-sign-go"
          type="submit"
          disabled={busy || username.trim().length < 3 || password.length < 6}
        >
          {busy ? "..." : mode === "login" ? t("Sign in") : t("Create account")}
        </button>
        <div
          className="ml-sign-switch"
          role="button"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(undefined);
          }}
        >
          {mode === "login" ? t("No account yet? Create one") : t("Have an account? Sign in")}
        </div>
      </form>
    </div>,
    document.body,
  );
}
