"use client";

import { type FormEvent, useEffect, useState } from "react";

import {
  PRIVACY_REQUEST_TYPES,
  privacyRequestLabel,
  type PrivacyRequestState,
  type PrivacyRequestType,
} from "@/lib/privacy-request";

type AccountPrivacyRequest = {
  reference: string;
  requestType: PrivacyRequestType;
  details: string;
  state: PrivacyRequestState;
  operatorResponse: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export function PrivacyRequestPanel() {
  const [requests, setRequests] = useState<AccountPrivacyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<string>();
  const [feedbackError, setFeedbackError] = useState(false);

  useEffect(() => {
    void loadRequests();
  }, []);

  async function loadRequests() {
    setLoading(true);
    try {
      const response = await fetch("/api/account/privacy-requests", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Privacy requests could not be loaded.");
      setRequests(body.requests as AccountPrivacyRequest[]);
    } catch (cause) {
      setFeedbackError(true);
      setFeedback(cause instanceof Error ? cause.message : "Privacy requests could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setFeedback(undefined);
    setFeedbackError(false);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/account/privacy-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestType: form.get("requestType"), details: form.get("details") }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "The privacy request could not be saved.");
      setRequests((current) => [body.request as AccountPrivacyRequest, ...current]);
      event.currentTarget.reset();
      setFeedback(body.message);
    } catch (cause) {
      setFeedbackError(true);
      setFeedback(cause instanceof Error ? cause.message : "The privacy request could not be saved.");
    } finally {
      setSending(false);
    }
  }

  async function cancelRequest(reference: string) {
    setFeedback(undefined);
    setFeedbackError(false);
    try {
      const response = await fetch(`/api/account/privacy-requests/${reference}`, { method: "PATCH" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "The privacy request could not be cancelled.");
      setRequests((current) => current.map((request) => request.reference === reference
        ? {
            ...request,
            state: "cancelled",
            updatedAt: body.request.updatedAt,
            completedAt: body.request.completedAt,
          }
        : request));
      setFeedback("The privacy request was cancelled.");
    } catch (cause) {
      setFeedbackError(true);
      setFeedback(cause instanceof Error ? cause.message : "The privacy request could not be cancelled.");
    }
  }

  return (
    <section className="privacy-desk" id="privacy-requests" aria-labelledby="privacy-desk-title">
      <div className="privacy-desk-heading">
        <div>
          <span>Account data</span>
          <h2 id="privacy-desk-title">Privacy requests</h2>
          <p>Ask for a copy, correction, deletion, or processing restriction. Financial, fraud-prevention, and public project records follow the published retention schedule.</p>
        </div>
        <nav aria-label="Data policy documents">
          <a href="/legal/privacy">Privacy notice</a>
          <a href="/legal/retention">Retention schedule</a>
          <a href="/legal/processors">Processor register</a>
        </nav>
      </div>

      <form className="privacy-request-form" onSubmit={(event) => void submitRequest(event)}>
        <label>Request type<select name="requestType" required>{PRIVACY_REQUEST_TYPES.map((type) => <option value={type} key={type}>{privacyRequestLabel(type)}</option>)}</select></label>
        <label>Details<textarea name="details" minLength={20} maxLength={1200} required placeholder="Name the account data or processing you want us to review." /></label>
        <button type="submit" disabled={sending}>{sending ? "Submitting…" : "Submit request"}</button>
      </form>
      {feedback ? <p className="privacy-feedback" role={feedbackError ? "alert" : "status"}>{feedback}</p> : null}

      {loading ? (
        <p className="privacy-empty" role="status">Loading privacy requests…</p>
      ) : requests.length === 0 ? (
        <p className="privacy-empty">No privacy requests from this account.</p>
      ) : (
        <ol className="privacy-request-list">
          {requests.map((request) => (
            <li key={request.reference}>
              <div className="privacy-request-cap">
                <span>Request {request.reference}</span>
                <strong data-state={request.state}>{request.state.replace("_", " ")}</strong>
              </div>
              <h3>{privacyRequestLabel(request.requestType)}</h3>
              <p>{request.details}</p>
              {request.operatorResponse ? <blockquote><span>Operator response</span>{request.operatorResponse}</blockquote> : null}
              <div className="privacy-request-foot">
                <time dateTime={request.createdAt}>{new Date(request.createdAt).toLocaleDateString()}</time>
                {request.state === "open" || request.state === "in_progress"
                  ? <button type="button" onClick={() => void cancelRequest(request.reference)}>Cancel request</button>
                  : <span>Closed {request.completedAt ? new Date(request.completedAt).toLocaleDateString() : ""}</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
