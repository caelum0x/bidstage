type DatabaseEnv = {
  databaseUrl: string;
  databaseSsl: boolean;
};

type ServerEnv = {
  appUrl: string;
  paymentProvider: "creem" | "dodo";
  turnstileSecretKey: string;
  founderAccessSecret: string;
  githubClientId: string;
  githubClientSecret: string;
  githubApiToken: string;
  rateLimitSalt: string;
  maintenanceSecret: string;
};

type CreemEnv = {
  apiKey: string;
  webhookSecret: string;
  productId: string;
  testMode: boolean;
};

type DodoEnv = {
  apiKey: string;
  webhookKey: string;
  productId: string;
  businessId: string;
  testMode: boolean;
};

type CloudflareUrlScannerEnv = {
  accountId: string;
  apiToken: string;
};

let cached: ServerEnv | undefined;
let cachedDatabase: DatabaseEnv | undefined;
let cachedCreem: CreemEnv | undefined;
let cachedDodo: DodoEnv | undefined;
let cachedCloudflareUrlScanner: CloudflareUrlScannerEnv | undefined;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const appUrl = new URL(required("APP_URL"));
  if (process.env.NODE_ENV === "production" && appUrl.protocol !== "https:") {
    throw new Error("APP_URL must use HTTPS in production");
  }
  const rateLimitSalt = required("RATE_LIMIT_SALT");
  if (rateLimitSalt.length < 32) throw new Error("RATE_LIMIT_SALT must be at least 32 characters");
  const founderAccessSecret = required("FOUNDER_ACCESS_SECRET");
  if (founderAccessSecret.length < 32) {
    throw new Error("FOUNDER_ACCESS_SECRET must be at least 32 characters");
  }
  const maintenanceSecret = required("MAINTENANCE_SECRET");
  if (maintenanceSecret.length < 32) {
    throw new Error("MAINTENANCE_SECRET must be at least 32 characters");
  }
  const paymentProvider = process.env.PAYMENT_PROVIDER?.trim().toLowerCase() || "creem";
  if (paymentProvider !== "creem" && paymentProvider !== "dodo") {
    throw new Error("PAYMENT_PROVIDER must be creem or dodo");
  }
  cached = {
    appUrl: appUrl.origin,
    paymentProvider,
    turnstileSecretKey: required("TURNSTILE_SECRET_KEY"),
    founderAccessSecret,
    githubClientId: required("GITHUB_CLIENT_ID"),
    githubClientSecret: required("GITHUB_CLIENT_SECRET"),
    githubApiToken: required("GITHUB_API_TOKEN"),
    rateLimitSalt,
    maintenanceSecret,
  };
  return cached;
}

export function creemEnv(): CreemEnv {
  if (cachedCreem) return cachedCreem;
  cachedCreem = {
    apiKey: required("CREEM_API_KEY"),
    webhookSecret: required("CREEM_WEBHOOK_SECRET"),
    productId: required("CREEM_PRODUCT_ID"),
    testMode: process.env.CREEM_TEST_MODE !== "false",
  };
  return cachedCreem;
}

export function dodoEnv(): DodoEnv {
  if (cachedDodo) return cachedDodo;
  cachedDodo = {
    apiKey: required("DODO_PAYMENTS_API_KEY"),
    webhookKey: required("DODO_PAYMENTS_WEBHOOK_KEY"),
    productId: required("DODO_PAYMENTS_PRODUCT_ID"),
    businessId: required("DODO_PAYMENTS_BUSINESS_ID"),
    testMode: process.env.DODO_PAYMENTS_TEST_MODE !== "false",
  };
  return cachedDodo;
}

export function cloudflareUrlScannerEnv(): CloudflareUrlScannerEnv {
  if (cachedCloudflareUrlScanner) return cachedCloudflareUrlScanner;
  const accountId = required("CLOUDFLARE_ACCOUNT_ID");
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID must be a 32-character account identifier");
  }
  const apiToken = required("CLOUDFLARE_URL_SCANNER_TOKEN");
  if (apiToken.length < 20 || apiToken.length > 200 || /\s/.test(apiToken)) {
    throw new Error("CLOUDFLARE_URL_SCANNER_TOKEN is invalid");
  }
  cachedCloudflareUrlScanner = { accountId, apiToken };
  return cachedCloudflareUrlScanner;
}

export function databaseEnv(): DatabaseEnv {
  if (cachedDatabase) return cachedDatabase;
  cachedDatabase = {
    databaseUrl: required("DATABASE_URL"),
    databaseSsl: process.env.DATABASE_SSL === "true",
  };
  return cachedDatabase;
}

export function resetServerEnvForTests(): void {
  cached = undefined;
  cachedDatabase = undefined;
  cachedCreem = undefined;
  cachedDodo = undefined;
  cachedCloudflareUrlScanner = undefined;
}
