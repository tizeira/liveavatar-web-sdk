"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import ClaraVoiceAgent from "../src/components/ClaraVoiceAgent";
import CustomerVerification from "../src/components/CustomerVerification";
import { CustomerData } from "../src/liveavatar/types";
import { UserMenu } from "../src/components/auth/LogoutButton";
import {
  ShopifyVerificationStates,
  type PageState as VerificationState,
} from "../src/components/ShopifyVerificationStates";
import {
  getMockCustomer,
  isMockMode,
  getMockScenario,
} from "@/src/lib/mock-data";
import { buildShopifyAccessRequestBody } from "@/src/shopify/access-request";

type PageState =
  | "loading"
  | "verifying_shopify"
  | "verifying_session"
  | "needs_verification"
  | "verified"
  | "error"
  | "shopify_redirect"
  | "no_orders"
  | "invalid_token"
  | "maintenance";

const SHOPIFY_ACCESS_TIMEOUT_MS = 5000;

export default function Home() {
  const { data: session, status: sessionStatus } = useSession();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [customerData, setCustomerData] = useState<CustomerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shopifyAccessChecked, setShopifyAccessChecked] = useState(false);
  const verifiedShopifyBuyerRef = useRef(false);
  const shopifyAccessErrorRef = useRef(false);

  // Verify customer via Shopify API (for users coming from Shopify iframe)
  const verifyShopifyCustomer = useCallback(async (params: URLSearchParams) => {
    setPageState("verifying_shopify");
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      SHOPIFY_ACCESS_TIMEOUT_MS,
    );

    try {
      const response = await fetch("/api/shopify-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildShopifyAccessRequestBody(params)),
        signal: controller.signal,
      });

      const data = await response.json();

      // Handle specific error cases with dedicated states
      if (!response.ok) {
        if (response.status === 401) {
          // Invalid HMAC token
          shopifyAccessErrorRef.current = true;
          setCustomerData({
            firstName: params.get("first_name") || undefined,
          });
          setPageState("invalid_token");
          return;
        }
        if (response.status === 403 && !data.hasOrders) {
          // Valid token but no orders
          shopifyAccessErrorRef.current = true;
          setCustomerData({
            firstName: params.get("first_name") || undefined,
            ordersCount: 0,
          });
          setPageState("no_orders");
          return;
        }
        throw new Error(data.error || "Verification failed");
      }

      if (!data.valid || !data.hasOrders) {
        shopifyAccessErrorRef.current = true;
        setCustomerData({
          firstName: params.get("first_name") || undefined,
          ordersCount: data.customer?.ordersCount || 0,
        });
        setPageState("no_orders");
        return;
      }

      if (data.customer) {
        const customer = {
          firstName: data.customer.firstName || undefined,
          ordersCount: data.customer.ordersCount,
          lastOrderProduct: data.customer.lastOrderProduct,
          lastOrderDate: data.customer.lastOrderDate,
        };
        setCustomerData(customer);
        verifiedShopifyBuyerRef.current = true;
        // Credentials and personal URL parameters are no longer needed after
        // the server has exchanged them for an HttpOnly buyer ticket.
        window.history.replaceState({}, "", window.location.pathname);
        setPageState("verified");
      }
    } catch (err) {
      console.error("Shopify verification error:", err);
      shopifyAccessErrorRef.current = true;
      setError(err instanceof Error ? err.message : "Error de verificacion");
      setPageState("error");
    } finally {
      window.clearTimeout(timeout);
      setShopifyAccessChecked(true);
    }
  }, []);

  const restoreShopifyAccess = useCallback(async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      SHOPIFY_ACCESS_TIMEOUT_MS,
    );

    try {
      const response = await fetch("/api/shopify-access", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return false;
      const data = await response.json();
      if (!data.valid || !data.hasOrders || !data.customer) return false;
      setCustomerData({
        firstName: data.customer.firstName || undefined,
        ordersCount: data.customer.ordersCount,
        lastOrderProduct: data.customer.lastOrderProduct || undefined,
        lastOrderDate: data.customer.lastOrderDate || undefined,
      });
      verifiedShopifyBuyerRef.current = true;
      setPageState("verified");
      return true;
    } catch (err) {
      shopifyAccessErrorRef.current = true;
      setError(
        err instanceof DOMException && err.name === "AbortError"
          ? "La validación de acceso tardó demasiado"
          : "No pudimos validar tu acceso en este momento",
      );
      setPageState("error");
      return false;
    } finally {
      window.clearTimeout(timeout);
      setShopifyAccessChecked(true);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("shopify_token") && params.has("customer_id")) return;
    void restoreShopifyAccess();
  }, [restoreShopifyAccess]);

  // Verify customer via email (for users with session)
  const verifySessionEmail = useCallback(
    async (email: string) => {
      setPageState("verifying_session");

      try {
        const response = await fetch("/api/verify-customer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });

        const data = await response.json();

        // Shopify Basic plan can't access PII via API.
        // For testing/team usage: if user has a Google session, let them in
        // with just their profile data — skip the "go to Shopify" redirect.
        if (data.error === "SHOPIFY_PLAN_LIMITED") {
          if (session?.user) {
            console.log(
              "[AUTH] Shopify plan limited — bypassing with Google profile",
            );
            setCustomerData({
              firstName: session.user.name?.split(" ")[0] || undefined,
              lastName:
                session.user.name?.split(" ").slice(1).join(" ") || undefined,
              email: session.user.email || undefined,
            });
            setPageState("verified");
            return;
          }
          setError(
            data.message ||
              "Por favor accede a Clara desde tu cuenta en la tienda BetaSkintech",
          );
          setPageState("shopify_redirect");
          return;
        }

        if (!response.ok) {
          throw new Error(data.error || "Error verifying customer");
        }

        if (!data.exists || !data.hasOrders) {
          // User has Google session but hasn't purchased on Shopify yet.
          // For testing/team usage: let them in with just their Google profile.
          // Clara will greet them by name but skinType/orders data will be missing.
          if (session?.user) {
            setCustomerData({
              firstName: session.user.name?.split(" ")[0] || undefined,
              lastName:
                session.user.name?.split(" ").slice(1).join(" ") || undefined,
              email: session.user.email || undefined,
            });
            setPageState("verified");
            return;
          }
          // No session at all → fall through to verification screen
          setPageState("needs_verification");
          return;
        }

        if (data.customer) {
          setCustomerData({
            firstName: data.customer.firstName || undefined,
            lastName: data.customer.lastName || undefined,
            email: data.customer.email || undefined,
            ordersCount: data.customer.ordersCount,
            skinType: data.customer.skinType as CustomerData["skinType"],
            skinConcerns: data.customer.skinConcerns,
          });
          setPageState("verified");
        }
      } catch (err) {
        console.error("Session verification error:", err);
        // On error, let user try manual verification
        setPageState("needs_verification");
      }
    },
    [session?.user],
  );

  // Main effect to handle page load and determine flow
  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);

    // Development-only visual QA for Clara's screens. Middleware blocks this
    // query in production, and no external avatar session is created.
    if (process.env.NODE_ENV !== "production" && params.has("design_preview")) {
      setCustomerData({
        firstName: "Ivan",
        ordersCount: 1,
        lastOrderProduct: "Booster 02 — Beta Lift",
      });
      setPageState("verified");
      return;
    }

    // Flow 0: Mock mode for testing (use ?mock=scenario_name)
    if (isMockMode(params)) {
      const scenario = getMockScenario(params);
      const mockCustomer = scenario ? getMockCustomer(scenario) : null;

      if (mockCustomer) {
        // Build params from mock customer data
        const mockParams = new URLSearchParams({
          customer_id: mockCustomer.customer_id,
          shopify_token: mockCustomer.shopify_token,
          first_name: mockCustomer.first_name,
          last_name: mockCustomer.last_name,
          email: mockCustomer.email,
          orders_count: mockCustomer.orders_count.toString(),
        });

        if (mockCustomer.last_order_date) {
          mockParams.set("last_order_date", mockCustomer.last_order_date);
        }
        if (mockCustomer.last_product) {
          mockParams.set("last_order_product", mockCustomer.last_product);
        }
        if (mockCustomer.skin_type) {
          mockParams.set("skin_type", mockCustomer.skin_type);
        }

        // Verify mock customer (will test full flow)
        verifyShopifyCustomer(mockParams);
        return;
      }
    }

    // Flow A: User coming from Shopify iframe with token
    if (params.has("shopify_token") && params.has("customer_id")) {
      if (shopifyAccessErrorRef.current) return;
      verifyShopifyCustomer(params);
      return;
    }

    if (!shopifyAccessChecked) {
      setPageState("loading");
      return;
    }

    // A valid HttpOnly buyer ticket is sufficient. Do not let the unrelated
    // NextAuth loading/unauthenticated state overwrite the restored access.
    if (verifiedShopifyBuyerRef.current) {
      setPageState("verified");
      return;
    }

    if (shopifyAccessErrorRef.current) return;

    // Flow B: Check URL params for direct customer data (legacy support)
    const firstName = params.get("first_name");
    const skinType = params.get("skin_type");
    const skinConcerns = params.get("skin_concerns");

    if (firstName || skinType || skinConcerns) {
      // Direct URL params without Shopify token - set data directly
      setCustomerData({
        firstName: firstName || undefined,
        lastName: params.get("last_name") || undefined,
        email: params.get("email") || undefined,
        ordersCount: params.get("orders_count")
          ? parseInt(params.get("orders_count")!, 10)
          : undefined,
        skinType: (skinType as CustomerData["skinType"]) || undefined,
        skinConcerns: skinConcerns
          ? skinConcerns.split(",").map((s) => s.trim())
          : undefined,
      });
      setPageState("verified");
      return;
    }

    // Flow C: Check session status
    if (sessionStatus === "loading") {
      setPageState("loading");
      return;
    }

    if (session?.user?.email) {
      // BYPASS: Test users skip Shopify verification
      const testEmails = ["tester@betaskintech.com", "demo@clara.ai"];
      if (testEmails.includes(session.user.email)) {
        setCustomerData({
          firstName: session.user.name?.split(" ")[0] || "Tester",
          email: session.user.email,
        });
        setPageState("verified");
        return;
      }

      // User has session - verify their email against Shopify
      verifySessionEmail(session.user.email);
      return;
    }

    // Flow D: No session, no Shopify token - show verification form
    // Note: middleware redirects to /login if no session and no shopify_token
    // This state shouldn't normally be reached unless middleware allows it
    setPageState("needs_verification");
  }, [
    session,
    sessionStatus,
    shopifyAccessChecked,
    verifyShopifyCustomer,
    verifySessionEmail,
  ]);

  // Handle successful verification from CustomerVerification component
  const handleVerified = (data: CustomerData) => {
    setCustomerData(data);
    setPageState("verified");
  };

  // Handle retry action
  const handleRetry = useCallback(() => {
    window.location.reload();
  }, []);

  // Keep access verification states on the same short, mobile-first surface.
  if (
    pageState === "loading" ||
    pageState === "verifying_shopify" ||
    pageState === "verifying_session" ||
    pageState === "no_orders" ||
    pageState === "invalid_token" ||
    pageState === "error" ||
    pageState === "maintenance"
  ) {
    const state: VerificationState =
      pageState === "verifying_shopify" || pageState === "verifying_session"
        ? "loading"
        : (pageState as VerificationState);

    return (
      <ShopifyVerificationStates
        state={state}
        customerData={customerData || undefined}
        onRetry={handleRetry}
      />
    );
  }

  // Shopify redirect state - show message to access from store
  if (pageState === "shopify_redirect") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 landing-gradient">
        <div className="text-center max-w-md card-ios relative z-10">
          <div className="mx-auto mb-4 w-16 h-16 rounded-full glass-morphism-strong flex items-center justify-center shadow-lg">
            <span
              className="text-2xl font-bold"
              style={{ color: "var(--platinum-800)" }}
            >
              C
            </span>
          </div>
          <h2 className="text-xl font-semibold text-neutral-800 mb-2">
            Accede desde la tienda
          </h2>
          <p className="text-neutral-600 mb-6">
            {error ||
              "Para usar Clara, ingresa a tu cuenta en BetaSkintech y accede desde ahi."}
          </p>
          <a
            href="https://betaskintech.com/account"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-6 py-3 btn-ios-primary rounded-2xl shadow-md font-medium"
          >
            <svg
              className="w-5 h-5 mr-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
              />
            </svg>
            Ir a BetaSkintech
          </a>
          <p className="mt-4 text-sm text-neutral-500 font-medium">
            Una vez en tu cuenta, busca el enlace a Clara
          </p>
        </div>
      </div>
    );
  }

  // Needs verification - show CustomerVerification component
  if (pageState === "needs_verification") {
    return <CustomerVerification onVerified={handleVerified} />;
  }

  // Verified - show Clara
  return (
    <div className="min-h-screen">
      {/* User menu for logout */}
      <div className="fixed top-4 right-4 z-50">
        <UserMenu />
      </div>
      <ClaraVoiceAgent
        userName={customerData?.firstName || session?.user?.name || null}
        customerData={customerData}
        designPreview={
          process.env.NODE_ENV !== "production" && typeof window !== "undefined"
            ? new URLSearchParams(window.location.search).get("design_preview")
            : null
        }
      />
    </div>
  );
}
