import { serverEnv } from "./env";
import { MarketInputError } from "./market";
import { verifyOsiApprovedLicense } from "./osi";

type GitHubRepositoryResponse = {
  id?: number;
  name?: string;
  full_name?: string;
  private?: boolean;
  html_url?: string;
  description?: string | null;
  stargazers_count?: number;
  language?: string | null;
  owner?: { id?: number; login?: string };
  license?: { spdx_id?: string | null } | null;
};

type GitHubContentResponse = {
  type?: string;
  encoding?: string;
  content?: string;
  size?: number;
};

export type VerifiedRepository = {
  id: number;
  owner: string;
  name: string;
  url: string;
  description: string | null;
  stars: number;
  licenseSpdx: string;
  primaryLanguage: string | null;
  verificationMethod: "personal_owner" | "repository_file";
};

function repositoryParts(raw: string): { owner: string; name: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new MarketInputError("Enter a valid public GitHub repository URL");
  }
  const parts = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || parts.length !== 2) {
    throw new MarketInputError("Use the canonical https://github.com/owner/repository URL");
  }
  return { owner: parts[0]!, name: parts[1]! };
}

export function matchesRepositoryAuthorization(value: unknown, githubUserId: number): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proof = value as Record<string, unknown>;
  return proof.type === "bidstage_repository_authorization"
    && proof.version === 1
    && proof.github_user_id === githubUserId;
}

async function hasRepositoryAuthorization(
  owner: string,
  name: string,
  githubUserId: number,
  headers: Record<string, string>,
): Promise<boolean> {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/.bidstage.json`,
    { headers, signal: AbortSignal.timeout(8_000) },
  );
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`GitHub repository authorization lookup failed with ${response.status}`);
  const file = await response.json() as GitHubContentResponse;
  if (
    file.type !== "file"
    || file.encoding !== "base64"
    || typeof file.content !== "string"
    || !Number.isSafeInteger(file.size)
    || file.size! < 1
    || file.size! > 1_024
  ) return false;
  try {
    const decoded = Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf8");
    return matchesRepositoryAuthorization(JSON.parse(decoded), githubUserId);
  } catch {
    return false;
  }
}

export async function verifyAuthorizedPublicRepository(
  rawUrl: string,
  githubUserId: number,
): Promise<VerifiedRepository> {
  const { owner, name } = repositoryParts(rawUrl);
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${serverEnv().githubApiToken}`,
    "User-Agent": "Bidstage",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    {
      headers,
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (response.status === 404) throw new MarketInputError("That public GitHub repository was not found");
  if (!response.ok) throw new Error(`GitHub repository lookup failed with ${response.status}`);
  const repository = await response.json() as GitHubRepositoryResponse;
  const license = repository.license?.spdx_id;
  if (repository.private) throw new MarketInputError("Bidstage accepts public GitHub repositories only");
  const verificationMethod = repository.owner?.id === githubUserId
    ? "personal_owner" as const
    : await hasRepositoryAuthorization(owner, name, githubUserId, headers)
      ? "repository_file" as const
      : null;
  if (!verificationMethod) {
    throw new MarketInputError("Organization repositories need a valid .bidstage.json authorization file on the default branch");
  }
  if (!license || license === "NOASSERTION" || license === "OTHER") {
    throw new MarketInputError("Open-source products need a license GitHub can identify with an SPDX ID");
  }
  await verifyOsiApprovedLicense(license);
  const ownerLogin = repository.owner?.login;
  if (
    !Number.isSafeInteger(repository.id)
    || !ownerLogin
    || !repository.name
    || !repository.html_url
    || !Number.isSafeInteger(repository.stargazers_count)
  ) throw new Error("GitHub returned incomplete repository metadata");
  return {
    id: repository.id!,
    owner: ownerLogin,
    name: repository.name,
    url: repository.html_url,
    description: repository.description?.trim().slice(0, 280) || null,
    stars: repository.stargazers_count!,
    licenseSpdx: license,
    primaryLanguage: repository.language?.trim().slice(0, 80) || null,
    verificationMethod,
  };
}
