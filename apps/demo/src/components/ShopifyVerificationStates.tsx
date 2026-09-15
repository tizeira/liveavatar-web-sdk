"use client";

import {
  AlertCircle,
  ChevronLeft,
  Loader2,
  ShoppingBag,
  Wrench,
  XCircle,
} from "lucide-react";
import styles from "./ClaraVoiceAgent.module.css";

export type PageState =
  | "loading"
  | "verified"
  | "no_orders"
  | "invalid_token"
  | "error"
  | "maintenance";

interface CustomerData {
  firstName?: string;
  email?: string;
  ordersCount?: number;
  lastOrderDate?: string;
}

interface ShopifyVerificationStatesProps {
  state: PageState;
  customerData?: CustomerData;
  onRetry?: () => void;
}

const Brand = () => (
  <div
    className={`${styles.brand} ${styles.display} ${styles.topBrand}`}
    aria-label="Beta Skintech"
  >
    <span className={styles.brandBeta}>BETA</span>
    <span className={styles.brandSkintech}>SKINTECH</span>
  </div>
);

export function ShopifyVerificationStates({
  state,
  customerData,
  onRetry,
}: ShopifyVerificationStatesProps) {
  if (state === "verified") return null;

  if (state === "loading") {
    return (
      <div
        className={`${styles.shell} ${styles.lightScreen}`}
        role="status"
        aria-live="polite"
      >
        <Brand />
        <main className={styles.centerContent}>
          <div className={styles.micHalo}>
            <Loader2 size={48} color="#0b63ce" className="animate-spin" />
          </div>
          <h1 className={`${styles.permissionTitle} ${styles.display}`}>
            Preparando tu acceso…
          </h1>
          <p className={styles.subtitle}>
            Estamos validando tu cuenta de Beta Skintech.
          </p>
        </main>
      </div>
    );
  }

  const content = {
    no_orders: {
      icon: <ShoppingBag size={34} />,
      title: `Hola${customerData?.firstName ? `, ${customerData.firstName}` : ""}`,
      body: "Para conversar con Clara necesitás tener al menos una compra en Beta Skintech.",
      note: "Después de tu primera compra, Clara podrá usar el producto como contexto para orientarte mejor.",
      action: "Ir a la tienda",
      href: "https://betaskintech.com",
    },
    invalid_token: {
      icon: <XCircle size={34} />,
      title: "No pudimos validar tu acceso",
      body: "El enlace puede haber vencido o no ser válido. Volvé a entrar a Clara desde tu cuenta en la tienda.",
      note: "Tus datos no fueron enviados a la conversación.",
      action: "Ir a mi cuenta",
      href: "https://betaskintech.com/account",
    },
    error: {
      icon: <AlertCircle size={34} />,
      title: "No pudimos conectarnos",
      body: "Ocurrió un problema temporal mientras preparábamos tu acceso a Clara.",
      note: "Podés volver a intentarlo sin perder tu acceso.",
      action: "Volver a intentar",
      href: null,
    },
    maintenance: {
      icon: <Wrench size={34} />,
      title: "Clara está en mantenimiento",
      body: "Estamos haciendo mejoras para que la conversación sea más estable.",
      note: "Volvé a intentarlo en unos minutos.",
      action: "Volver a la tienda",
      href: "https://betaskintech.com",
    },
  }[state];

  if (!content) return null;

  return (
    <div className={`${styles.shell} ${styles.lightScreen}`}>
      <Brand />
      {onRetry && state !== "no_orders" && (
        <button
          type="button"
          className={styles.backButton}
          onClick={onRetry}
          aria-label="Volver a intentar"
        >
          <ChevronLeft size={20} />
        </button>
      )}
      <main className={styles.centerContent}>
        <div className={styles.micHalo}>
          <div className={styles.micDisc}>{content.icon}</div>
        </div>
        <h1 className={`${styles.permissionTitle} ${styles.display}`}>
          {content.title}
        </h1>
        <p className={styles.subtitle}>{content.body}</p>
        <div
          className={styles.recapCard}
          style={{ marginTop: 24, textAlign: "left" }}
        >
          <p className={styles.recapText}>{content.note}</p>
        </div>
      </main>
      <div className={styles.bottomActions}>
        {content.href ? (
          <a className={styles.primaryButton} href={content.href}>
            {content.action}
          </a>
        ) : (
          <button
            type="button"
            className={styles.primaryButton}
            onClick={onRetry}
          >
            {content.action}
          </button>
        )}
      </div>
    </div>
  );
}
