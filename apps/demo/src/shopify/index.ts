/**
 * Shopify Integration Module
 * Exports all Shopify-related functionality
 */

// Types
export type {
  ShopifyCustomer,
  ShopifyOrder,
  ShopifyCustomerRequest,
  ShopifyCustomerResponse,
  VerifyCustomerRequest,
  VerifyCustomerResponse,
} from "./types";

// Security functions
export {
  generateCustomerToken,
  verifyCustomerToken,
  isValidCustomerId,
  cleanCustomerId,
  isHmacConfigured,
  buildClaraShopifyAccessPayload,
  verifyClaraShopifyAccessToken,
  CLARA_SHOPIFY_SIGNATURE_VERSION,
  CLARA_SHOPIFY_LINK_MAX_AGE_SECONDS,
} from "./security";

// Client functions
export {
  fetchCustomerByEmail,
  fetchCustomerById,
  isShopifyConfigured,
} from "./client";

// Queries (for testing/debugging)
export {
  CUSTOMER_BY_EMAIL_QUERY,
  CUSTOMER_BY_ID_QUERY,
  CUSTOMER_EXISTS_QUERY,
} from "./queries";
