import { type NextRequest, NextResponse } from "next/server";

import { authenticatedFounder } from "@/lib/auth";
import type { ContributionApplicationState } from "@/lib/contribution-application";
import { query } from "@/lib/db";

type OutgoingRow = {
  id: string;
  state: ContributionApplicationState;
  message: string;
  created_at: Date;
  updated_at: Date;
  listing_slug: string;
  listing_title: string;
  contribution_note: string | null;
  contribution_url: string | null;
  repository_url: string | null;
};

type IncomingRow = {
  id: string;
  state: ContributionApplicationState;
  message: string;
  created_at: Date;
  updated_at: Date;
  listing_slug: string;
  listing_title: string;
  github_login: string;
  display_name: string | null;
  profile_url: string;
  headline: string | null;
  skills: string[] | null;
  availability: string | null;
};

export async function GET(request: NextRequest) {
  const founder = await authenticatedFounder(request);
  if (!founder) {
    return NextResponse.json(
      { error: "authentication_required" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  try {
    const [outgoing, incoming] = await Promise.all([
      query<OutgoingRow>(
        `SELECT application.id, application.state, application.message,
                application.created_at, application.updated_at,
                listing.slug AS listing_slug, listing.title AS listing_title,
                listing.contribution_note, listing.contribution_url,
                listing.github_url AS repository_url
         FROM contribution_applications AS application
         JOIN listings AS listing ON listing.id = application.listing_id
         WHERE application.contributor_id = $1
         ORDER BY application.created_at DESC
         LIMIT 100`,
        [founder.id],
      ),
      query<IncomingRow>(
        `SELECT application.id, application.state, application.message,
                application.created_at, application.updated_at,
                listing.slug AS listing_slug, listing.title AS listing_title,
                applicant.github_login, applicant.display_name, applicant.profile_url,
                CASE WHEN profile.is_public THEN profile.headline ELSE NULL END AS headline,
                CASE WHEN profile.is_public THEN profile.skills ELSE NULL END AS skills,
                CASE WHEN profile.is_public THEN profile.availability ELSE NULL END AS availability
         FROM contribution_applications AS application
         JOIN listings AS listing ON listing.id = application.listing_id
         JOIN founder_accounts AS applicant ON applicant.id = application.contributor_id
         LEFT JOIN contributor_profiles AS profile ON profile.founder_id = applicant.id
         WHERE listing.founder_id = $1
         ORDER BY (application.state = 'pending') DESC, application.created_at DESC
         LIMIT 100`,
        [founder.id],
      ),
    ]);
    return NextResponse.json(
      {
        outgoing: outgoing.map((row) => ({
          id: row.id,
          state: row.state,
          message: row.message,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
          project: {
            slug: row.listing_slug,
            title: row.listing_title,
            contributionNote: row.contribution_note,
            contributionUrl: row.contribution_url,
            repositoryUrl: row.repository_url,
          },
        })),
        incoming: incoming.map((row) => ({
          id: row.id,
          state: row.state,
          message: row.message,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
          project: { slug: row.listing_slug, title: row.listing_title },
          contributor: {
            githubLogin: row.github_login,
            displayName: row.display_name,
            profileUrl: row.profile_url,
            headline: row.headline,
            skills: row.skills,
            availability: row.availability,
          },
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "applications_unavailable", message: "Contribution applications are temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
