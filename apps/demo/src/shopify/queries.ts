/**
 * Shopify GraphQL Queries
 * Admin API queries for customer data retrieval
 */

import { BETA_SKINCARE_NAMESPACE } from "./types";

/**
 * Query to find customer by email
 * Used for direct verification flow (when user enters email)
 *
 * Note: On Shopify Basic plan, PII fields (firstName, lastName, email)
 * may return null. We use Liquid template workaround for those.
 */
export const CUSTOMER_BY_EMAIL_QUERY = `
  query customerByEmail($query: String!) {
    customers(first: 1, query: $query) {
      edges {
        node {
          id
          email
          firstName
          lastName
          numberOfOrders
          metafields(first: 10, namespace: "${BETA_SKINCARE_NAMESPACE}") {
            edges {
              node {
                key
                value
                type
              }
            }
          }
          orders(first: 5, reverse: true) {
            edges {
              node {
                name
                createdAt
                totalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                lineItems(first: 10) {
                  edges {
                    node {
                      title
                      quantity
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Query to get customer by ID
 * Used for Shopify iframe flow (when customer_id comes from URL)
 */
export const CUSTOMER_BY_ID_QUERY = `
  query customerById($id: ID!) {
    customer(id: $id) {
      id
      email
      firstName
      lastName
      numberOfOrders
      metafields(first: 10, namespace: "${BETA_SKINCARE_NAMESPACE}") {
        edges {
          node {
            key
            value
            type
          }
        }
      }
      orders(first: 5, reverse: true) {
        edges {
          node {
            name
            createdAt
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            lineItems(first: 10) {
              edges {
                node {
                  title
                  quantity
                }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Minimal legacy-link entitlement check. It deliberately avoids customer PII
 * and order contents; only purchase count is required at this boundary.
 */
export const CUSTOMER_PURCHASE_COUNT_BY_ID_QUERY = `
  query customerPurchaseCountById($id: ID!) {
    customer(id: $id) {
      numberOfOrders
    }
  }
`;

/**
 * Simple query to check if customer exists and has orders
 * Lighter query for quick verification
 */
export const CUSTOMER_EXISTS_QUERY = `
  query customerExists($query: String!) {
    customers(first: 1, query: $query) {
      edges {
        node {
          id
          numberOfOrders
        }
      }
    }
  }
`;

export const PRODUCTS_FOR_CLARA_QUERY = `
  query productsForClara($first: Int!) {
    shop {
      currencyCode
      primaryDomain { url }
    }
    products(first: $first, query: "status:active", sortKey: TITLE) {
      nodes {
        id
        title
        handle
        description
        productType
        tags
        status
        onlineStoreUrl
        resourcePublicationsV2(first: 20) {
          nodes {
            isPublished
            publication { name }
          }
        }
        featuredMedia {
          preview {
            image {
              url
              altText
            }
          }
        }
        variants(first: 20) {
          nodes {
            availableForSale
            price
            compareAtPrice
          }
        }
        companionCondition: metafield(namespace: "custom", key: "clara_companion_condition") {
          value
        }
        companionProducts: metafield(namespace: "custom", key: "clara_companion_products") {
          references(first: 5) {
            nodes {
              ... on Product {
                id
                title
                handle
                description
                productType
                tags
                status
                onlineStoreUrl
                resourcePublicationsV2(first: 20) {
                  nodes {
                    isPublished
                    publication { name }
                  }
                }
                featuredMedia {
                  preview {
                    image {
                      url
                      altText
                    }
                  }
                }
                variants(first: 20) {
                  nodes {
                    availableForSale
                    price
                    compareAtPrice
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const PRODUCT_FOR_CLARA_BY_HANDLE_QUERY = `
  query productForClaraByHandle($handle: String!) {
    shop {
      currencyCode
      primaryDomain { url }
    }
    productByHandle(handle: $handle) {
      id
      title
      handle
      description
      status
      onlineStoreUrl
      resourcePublicationsV2(first: 20) {
        nodes {
          isPublished
          publication { name }
        }
      }
      featuredMedia {
        preview {
          image {
            url
            altText
          }
        }
      }
      variants(first: 20) {
        nodes {
          availableForSale
          price
          compareAtPrice
        }
      }
      companionCondition: metafield(namespace: "custom", key: "clara_companion_condition") {
        value
      }
      companionProducts: metafield(namespace: "custom", key: "clara_companion_products") {
        references(first: 5) {
          nodes {
            ... on Product {
              id
              title
              handle
              description
              productType
              tags
              status
              onlineStoreUrl
              resourcePublicationsV2(first: 20) {
                nodes {
                  isPublished
                  publication { name }
                }
              }
              featuredMedia {
                preview {
                  image {
                    url
                    altText
                  }
                }
              }
              variants(first: 20) {
                nodes {
                  availableForSale
                  price
                  compareAtPrice
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const PRODUCTS_FOR_CLARA_BY_HANDLES_QUERY = `
  query productsForClaraByHandles($first: Int!, $query: String!) {
    shop {
      currencyCode
      primaryDomain { url }
    }
    products(first: $first, query: $query) {
      nodes {
        id
        title
        handle
        description
        productType
        tags
        status
        onlineStoreUrl
        resourcePublicationsV2(first: 20) {
          nodes {
            isPublished
            publication { name }
          }
        }
        featuredMedia {
          preview { image { url altText } }
        }
        variants(first: 20) {
          nodes { availableForSale price compareAtPrice }
        }
        companionCondition: metafield(namespace: "custom", key: "clara_companion_condition") {
          value
        }
        companionProducts: metafield(namespace: "custom", key: "clara_companion_products") {
          references(first: 5) {
            nodes {
              ... on Product {
                id
                title
                handle
                description
                productType
                tags
                status
                onlineStoreUrl
                resourcePublicationsV2(first: 20) {
                  nodes { isPublished publication { name } }
                }
                featuredMedia { preview { image { url altText } } }
                variants(first: 20) {
                  nodes { availableForSale price compareAtPrice }
                }
              }
            }
          }
        }
      }
    }
  }
`;
