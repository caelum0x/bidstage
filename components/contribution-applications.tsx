"use client";

import { useCallback, useEffect, useState } from "react";

type ApplicationState = "pending" | "accepted" | "declined" | "withdrawn";

type OutgoingApplication = {
  id: string;
  state: ApplicationState;
  message: string;
  createdAt: string;
  project: {
    slug: string;
    title: string;
    contributionNote: string | null;
    contributionUrl: string | null;
    repositoryUrl: string | null;
  };
};

type IncomingApplication = {
  id: string;
  state: ApplicationState;
  message: string;
  createdAt: string;
  project: { slug: string; title: string };
  contributor: {
    githubLogin: string;
    displayName: string | null;
    profileUrl: string;
    headline: string | null;
    skills: string[] | null;
    availability: string | null;
  };
};

type ApplicationData = {
  incoming: IncomingApplication[];
  outgoing: OutgoingApplication[];
};

type CorrespondenceMessage = {
  id: string;
  author: "you" | "maintainer" | "contributor";
  body: string;
  createdAt: string;
};

type Correspondence = { applicationId: string; messages: CorrespondenceMessage[] };

export function ContributionApplications() {
  const [data, setData] = useState<ApplicationData>();
  const [error, setError] = useState<string>();
  const [workingId, setWorkingId] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [correspondence, setCorrespondence] = useState<Correspondence>();
  const [threadMessage, setThreadMessage] = useState("");
  const [threadWorking, setThreadWorking] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/account/applications", { cache: "no-store" });
      const body = await response.json();
      if (response.status === 401) return;
      if (!response.ok) throw new Error(body.message ?? "Applications could not be loaded.");
      setData(body as ApplicationData);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Applications could not be loaded.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function update(id: string, action: "accept" | "decline" | "withdraw") {
    setWorkingId(id);
    setNotice(undefined);
    try {
      const response = await fetch(`/api/account/applications/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Application could not be updated.");
      const state = body.application.state as ApplicationState;
      setData((current) => current ? {
        incoming: current.incoming.map((item) => item.id === id ? { ...item, state } : item),
        outgoing: current.outgoing.map((item) => item.id === id ? { ...item, state } : item),
      } : current);
      setNotice(`Application marked ${state}.`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Application could not be updated.");
    } finally {
      setWorkingId(undefined);
    }
  }

  async function openCorrespondence(id: string) {
    if (correspondence?.applicationId === id) {
      setCorrespondence(undefined);
      setThreadMessage("");
      return;
    }
    setWorkingId(id);
    setNotice(undefined);
    try {
      const response = await fetch(`/api/account/applications/${encodeURIComponent(id)}/messages`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Correspondence could not be opened.");
      setCorrespondence(body as Correspondence);
      setThreadMessage("");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Correspondence could not be opened.");
    } finally {
      setWorkingId(undefined);
    }
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!correspondence) return;
    setThreadWorking(true);
    setNotice(undefined);
    try {
      const response = await fetch(`/api/account/applications/${encodeURIComponent(correspondence.applicationId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: threadMessage }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Message could not be sent.");
      setCorrespondence((current) => current ? { ...current, messages: [...current.messages, body.message as CorrespondenceMessage] } : current);
      setThreadMessage("");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Message could not be sent.");
    } finally {
      setThreadWorking(false);
    }
  }

  function correspondencePanel(applicationId: string) {
    if (correspondence?.applicationId !== applicationId) return null;
    return <section className="application-correspondence" id={`correspondence-${applicationId}`} aria-label="Private correspondence">
      <div className="correspondence-cap"><strong>Private correspondence</strong><span>{correspondence.messages.length} {correspondence.messages.length === 1 ? "message" : "messages"}</span></div>
      {correspondence.messages.length ? <ol>{correspondence.messages.map((message) => <li className={message.author === "you" ? "message-from-you" : ""} key={message.id}><span>{message.author === "you" ? "You" : message.author}<time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time></span><p>{message.body}</p></li>)}</ol> : <p className="correspondence-empty">No follow-up messages yet. Use this thread to coordinate repository work after the introduction was accepted.</p>}
      <form onSubmit={sendMessage}><label>New message<textarea minLength={3} maxLength={1200} value={threadMessage} onChange={(event) => setThreadMessage(event.target.value)} required /></label><button type="submit" disabled={threadWorking}>{threadWorking ? "Sending…" : "Send message"}</button></form>
    </section>;
  }

  if (!loaded) return <section className="application-desk" role="status"><span className="loader" aria-hidden="true" /><strong>Reading contribution applications…</strong></section>;
  if (!data && !error) return null;

  return (
    <section className="application-desk" aria-labelledby="application-desk-title">
      <div className="application-desk-heading"><span>Contributor ↔ maintainer</span><div><h2 id="application-desk-title">Application desk.</h2><p>Private introductions around repository-bound work. Acceptance records interest only; Bidstage does not create employment, bounty, or payment obligations.</p></div></div>
      {error ? <p className="account-notice" role="alert">{error}</p> : null}
      {notice ? <p className="account-notice" role="status">{notice}</p> : null}
      {data ? <div className="application-columns">
        <section><h3>For your projects <span>{data.incoming.length}</span></h3>{data.incoming.length === 0 ? <p className="application-empty">No contributors have applied to your projects.</p> : <ol>{data.incoming.map((application) => <li key={application.id}><div className="application-cap"><span>{application.state}</span><time dateTime={application.createdAt}>{new Date(application.createdAt).toLocaleDateString()}</time></div><h4>{application.project.title}</h4><a href={application.contributor.profileUrl} target="_blank" rel="noopener">@{application.contributor.githubLogin}</a>{application.contributor.headline ? <p><strong>{application.contributor.headline}</strong></p> : null}<blockquote>{application.message}</blockquote>{application.contributor.skills?.length ? <ul>{application.contributor.skills.map((skill) => <li key={skill}>{skill}</li>)}</ul> : null}{application.state === "pending" ? <div className="application-buttons"><button type="button" disabled={workingId === application.id} onClick={() => void update(application.id, "decline")}>Decline</button><button type="button" disabled={workingId === application.id} onClick={() => void update(application.id, "accept")}>Accept introduction</button></div> : application.state === "accepted" ? <div className="application-buttons"><button type="button" aria-expanded={correspondence?.applicationId === application.id} aria-controls={`correspondence-${application.id}`} disabled={workingId === application.id} onClick={() => void openCorrespondence(application.id)}>{correspondence?.applicationId === application.id ? "Close correspondence" : "Open correspondence"}</button></div> : null}{correspondencePanel(application.id)}</li>)}</ol>}</section>
        <section><h3>Your applications <span>{data.outgoing.length}</span></h3>{data.outgoing.length === 0 ? <p className="application-empty">No applications yet. Browse concrete work from verified repositories.</p> : <ol>{data.outgoing.map((application) => <li key={application.id}><div className="application-cap"><span>{application.state}</span><time dateTime={application.createdAt}>{new Date(application.createdAt).toLocaleDateString()}</time></div><h4>{application.project.title}</h4><blockquote>{application.message}</blockquote><div className="application-links"><a href={`/listing/${application.project.slug}`}>Project record</a>{application.project.contributionUrl ? <a href={application.project.contributionUrl} target="_blank" rel="noopener">Open work</a> : null}</div>{application.state === "pending" ? <div className="application-buttons"><button type="button" disabled={workingId === application.id} onClick={() => void update(application.id, "withdraw")}>Withdraw</button></div> : application.state === "accepted" ? <div className="application-buttons"><button type="button" aria-expanded={correspondence?.applicationId === application.id} aria-controls={`correspondence-${application.id}`} disabled={workingId === application.id} onClick={() => void openCorrespondence(application.id)}>{correspondence?.applicationId === application.id ? "Close correspondence" : "Open correspondence"}</button></div> : null}{correspondencePanel(application.id)}</li>)}</ol>}<a className="browse-applications" href="/opportunities">Browse opportunities</a></section>
      </div> : null}
    </section>
  );
}
