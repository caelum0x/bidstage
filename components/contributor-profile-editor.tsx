"use client";

import { type FormEvent, useEffect, useState } from "react";

import { COUNTRY_CODES, countryName, type CountryCode } from "@/lib/countries";
import type { ContributorAvailability } from "@/lib/contributor-profile";

type ContributorProfile = {
  headline: string;
  bio: string | null;
  countryCode: CountryCode | null;
  skills: string[];
  availability: ContributorAvailability;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
};

type ProfileData = {
  founder: { githubLogin: string; profileUrl: string };
  profile: ContributorProfile | null;
};

const countryOptions = COUNTRY_CODES.map((code) => ({ code, name: countryName(code) }))
  .sort((left, right) => left.name.localeCompare(right.name));

export function ContributorProfileEditor() {
  const [data, setData] = useState<ProfileData>();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void fetch("/api/account/contributor-profile", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) return undefined;
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? "Your contributor profile could not be loaded.");
        return body as ProfileData;
      })
      .then((body) => setData(body))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Your contributor profile could not be loaded."))
      .finally(() => setLoaded(true));
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    setMessage(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/account/contributor-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          headline: form.get("headline"),
          bio: form.get("bio"),
          countryCode: form.get("countryCode"),
          skills: String(form.get("skills") ?? "").split(",").map((skill) => skill.trim()).filter(Boolean),
          availability: form.get("availability"),
          isPublic: form.get("isPublic") === "on",
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Your contributor profile could not be saved.");
      setData((current) => current ? { ...current, profile: body.profile as ContributorProfile } : current);
      setMessage(body.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your contributor profile could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <section className="contributor-editor"><span className="loader" /><strong>Reading contributor profile…</strong></section>;
  if (!data) return error ? <section className="contributor-editor"><strong>Contributor profile unavailable.</strong><p className="form-error">{error}</p></section> : null;
  const profile = data.profile;

  return (
    <section className="contributor-editor" id="contributor-profile">
      <div className="contributor-editor-heading">
        <div><span>Contributor directory</span><h2>Publish how you can help.</h2><p>This profile is separate from project ownership and payment records. It appears publicly only when you opt in.</p></div>
        <a href="/contributors">View directory</a>
      </div>
      <form onSubmit={save}>
        <label>Headline<input name="headline" minLength={3} maxLength={100} defaultValue={profile?.headline ?? ""} placeholder="Documentation and TypeScript contributor" required /></label>
        <label>Bio<textarea name="bio" minLength={3} maxLength={500} defaultValue={profile?.bio ?? ""} placeholder="Describe the open-source work you want to do." /></label>
        <div className="form-row">
          <label>Skills<input name="skills" defaultValue={profile?.skills.join(", ") ?? ""} placeholder="TypeScript, documentation, accessibility" required /><small>1–8 skills, separated by commas.</small></label>
          <label>Country<select name="countryCode" defaultValue={profile?.countryCode ?? ""}><option value="">Not listed</option>{countryOptions.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
        </div>
        <label>Availability<select name="availability" defaultValue={profile?.availability ?? "available"}><option value="available">Available for contributions</option><option value="limited">Limited availability</option><option value="unavailable">Not currently available</option></select></label>
        <label className="check"><input name="isPublic" type="checkbox" defaultChecked={profile?.isPublic ?? false} /><span>Publish this profile in the contributor directory. My GitHub profile, headline, bio, country, skills, and availability will be public.</span></label>
        {message ? <p className="verification-success" role="status">{message}</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save contributor profile"}</button>
      </form>
    </section>
  );
}
