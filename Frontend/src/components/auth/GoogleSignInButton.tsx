import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    google?: any;
  }
}

const GOOGLE_SCRIPT_ID = "google-identity-services";
const GOOGLE_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

const loadGoogleScript = () =>
  new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(GOOGLE_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if (window.google?.accounts?.id) {
        resolve();
        return;
      }

      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Google script")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.id = GOOGLE_SCRIPT_ID;
    script.src = GOOGLE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google script"));
    document.head.appendChild(script);
  });

interface GoogleSignInButtonProps {
  clientId: string;
  disabled?: boolean;
  onCredential: (credential: string) => void;
  onError?: (message: string) => void;
}

export function GoogleSignInButton({
  clientId,
  disabled,
  onCredential,
  onError,
}: GoogleSignInButtonProps) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [isScriptReady, setIsScriptReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    loadGoogleScript()
      .then(() => {
        if (!cancelled) {
          setIsScriptReady(true);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          onError?.(error instanceof Error ? error.message : "Unable to load Google sign-in");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [onError]);

  useEffect(() => {
    if (!isScriptReady || !clientId || !buttonRef.current) {
      return;
    }

    const googleIdentity = window.google?.accounts?.id;
    if (!googleIdentity) {
      onError?.("Google identity services are unavailable in this browser.");
      return;
    }

    googleIdentity.initialize({
      client_id: clientId,
      callback: (response: { credential?: string }) => {
        const credential = String(response?.credential || "").trim();
        if (!credential) {
          onError?.("Google sign-in did not return a credential.");
          return;
        }

        onCredential(credential);
      },
    });

    buttonRef.current.innerHTML = "";

    googleIdentity.renderButton(buttonRef.current, {
      theme: "filled_black",
      size: "large",
      text: "continue_with",
      shape: "pill",
      width: 320,
    });
  }, [clientId, isScriptReady, onCredential, onError]);

  return (
    <div aria-disabled={disabled} className={disabled ? "pointer-events-none opacity-50" : ""}>
      <div ref={buttonRef} className="min-h-[44px]" />
    </div>
  );
}
