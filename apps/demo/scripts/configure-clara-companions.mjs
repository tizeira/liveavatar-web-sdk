const API_VERSION = "2026-07";
const namespace = "custom";
const companionProductsKey = "clara_companion_products";
const companionConditionKey = "clara_companion_condition";
const condition = "if_no_moisturizer";
const companionHandle = "beta-cream-ultra-hydrating-facial-universal";
const treatmentHandles = [
  "beta-hacker-id-longevity",
  "beta-hacker-id-structure",
  "beta-hacker-id-radiance",
  "beta-hacker-id-balance",
  "beta-hacker-id-cell-reset",
];

const apply = process.argv.includes("--apply");
const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

if (!storeDomain || !accessToken) {
  throw new Error("Shopify credentials are not configured");
}

async function graphql(query, variables = {}) {
  const response = await fetch(
    `https://${storeDomain}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  const result = await response.json();
  if (!response.ok || result.errors?.length) {
    throw new Error(
      `Shopify request failed: ${JSON.stringify(result.errors || response.status)}`,
    );
  }
  return result.data;
}

const catalog = await graphql(`
  query ClaraCompanionCatalog {
    products(first: 100, query: "status:active") {
      nodes {
        id
        title
        handle
        status
        companionProducts: metafield(
          namespace: "custom"
          key: "clara_companion_products"
        ) {
          value
          compareDigest
        }
        companionCondition: metafield(
          namespace: "custom"
          key: "clara_companion_condition"
        ) {
          value
          compareDigest
        }
      }
    }
    metafieldDefinitions(first: 100, ownerType: PRODUCT, namespace: "custom") {
      nodes {
        id
        key
        type {
          name
        }
      }
    }
  }
`);

const products = catalog.products.nodes;
const companion = products.find(
  (product) => product.handle === companionHandle,
);
const treatments = treatmentHandles.map((handle) =>
  products.find((product) => product.handle === handle),
);

if (!companion || treatments.some((product) => !product)) {
  const found = new Set(products.map((product) => product.handle));
  const missing = [companionHandle, ...treatmentHandles].filter(
    (handle) => !found.has(handle),
  );
  throw new Error(
    `Expected active products were not found: ${missing.join(", ")}`,
  );
}

const existingDefinitions = new Set(
  catalog.metafieldDefinitions.nodes.map((definition) => definition.key),
);
const configured = treatments.filter(
  (product) =>
    product.companionProducts?.value === JSON.stringify([companion.id]) &&
    product.companionCondition?.value === condition,
);

console.log(
  JSON.stringify(
    {
      mode: apply ? "apply" : "dry-run",
      companion: companion.handle,
      treatments: treatments.map((product) => product.handle),
      alreadyConfigured: configured.map((product) => product.handle),
      definitionsToCreate: [companionProductsKey, companionConditionKey].filter(
        (key) => !existingDefinitions.has(key),
      ),
    },
    null,
    2,
  ),
);

if (!apply) process.exit(0);

const definitions = [
  {
    name: "Clara companion products",
    namespace,
    key: companionProductsKey,
    description:
      "Productos complementarios verificados que Clara puede recomendar.",
    type: "list.product_reference",
    ownerType: "PRODUCT",
  },
  {
    name: "Clara companion condition",
    namespace,
    key: companionConditionKey,
    description: "Condición controlada para recomendar el complemento.",
    type: "single_line_text_field",
    ownerType: "PRODUCT",
  },
];

for (const definition of definitions) {
  if (existingDefinitions.has(definition.key)) continue;
  const created = await graphql(
    `
      mutation CreateClaraDefinition($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition {
            id
            key
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `,
    { definition },
  );
  const errors = created.metafieldDefinitionCreate.userErrors;
  if (errors.length) throw new Error(JSON.stringify(errors));
}

const metafields = treatments.flatMap((product) => [
  {
    ownerId: product.id,
    namespace,
    key: companionProductsKey,
    type: "list.product_reference",
    value: JSON.stringify([companion.id]),
    compareDigest: product.companionProducts?.compareDigest ?? null,
  },
  {
    ownerId: product.id,
    namespace,
    key: companionConditionKey,
    type: "single_line_text_field",
    value: condition,
    compareDigest: product.companionCondition?.compareDigest ?? null,
  },
]);

const updated = await graphql(
  `
    mutation SetClaraCompanions($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          owner {
            ... on Product {
              handle
            }
          }
          key
          value
        }
        userErrors {
          field
          message
          code
        }
      }
    }
  `,
  { metafields },
);

if (updated.metafieldsSet.userErrors.length) {
  throw new Error(JSON.stringify(updated.metafieldsSet.userErrors));
}

console.log(
  JSON.stringify({
    updatedMetafields: updated.metafieldsSet.metafields.length,
  }),
);
