import { describe, expect, it } from "vitest";
import type { DocumentKind, OrbitDocument } from "@orbit/types";
import { MAX_SESSION_DOCUMENTS } from "@orbit/ui";
import { addSessionDocument, defaultSessionDocuments, sessionDocumentIds, toggleSessionDocument } from "./sessionDocs";

const doc = (id: string, kind: DocumentKind, status: OrbitDocument["status"] = "ready"): OrbitDocument => ({
  id,
  title: id,
  kind,
  filename: null,
  size_bytes: 100,
  status,
  chunk_count: 3,
  created_at: "2026-10-17T10:00:00Z",
});

// Newest first, as the API lists them.
const many = (n: number, kind: DocumentKind, prefix: string) => Array.from({ length: n }, (_, i) => doc(`${prefix}${i}`, kind));

describe("the documents a new session reads", () => {
  it("ticks the ready resumes and job descriptions, not notes or unreadable files", () => {
    const docs = [doc("r1", "resume"), doc("n1", "notes"), doc("j1", "job_description"), doc("r2", "resume", "failed")];
    expect([...defaultSessionDocuments(docs)]).toEqual(["r1", "j1"]);
  });

  it("never ticks more than a session can take (22 saved: Start used to fail)", () => {
    const docs = [...many(11, "job_description", "j"), ...many(11, "resume", "r")];
    const ticked = defaultSessionDocuments(docs);
    expect(ticked.size).toBe(MAX_SESSION_DOCUMENTS);
    expect(sessionDocumentIds(ticked, docs)).toHaveLength(MAX_SESSION_DOCUMENTS);
  });

  it("keeps the newest resume and job description when newer ones of one kind would fill the limit", () => {
    const docs = [...many(25, "job_description", "j"), doc("resume-new", "resume"), doc("resume-old", "resume")];
    const ticked = defaultSessionDocuments(docs);
    expect(ticked.has("resume-new")).toBe(true);
    expect(ticked.has("j0")).toBe(true);
    expect(ticked.has("resume-old")).toBe(false);
  });

  it("refuses one more tick at the limit, but always allows unticking", () => {
    const full = new Set(many(MAX_SESSION_DOCUMENTS, "resume", "r").map((d) => d.id));
    expect(toggleSessionDocument(full, "extra").has("extra")).toBe(false);
    expect(toggleSessionDocument(full, "r0").has("r0")).toBe(false);
    expect(toggleSessionDocument(new Set(["a"]), "b")).toEqual(new Set(["a", "b"]));
  });

  it("ticks an uploaded document only while there's room, and never unticks it", () => {
    expect(addSessionDocument(new Set(["a"]), "a")).toEqual(new Set(["a"]));
    expect(addSessionDocument(new Set(), "new")).toEqual(new Set(["new"]));
    const full = new Set(many(MAX_SESSION_DOCUMENTS, "resume", "r").map((d) => d.id));
    expect(addSessionDocument(full, "new").size).toBe(MAX_SESSION_DOCUMENTS);
  });

  it("sends only documents that still exist", () => {
    const docs = [doc("r1", "resume")];
    expect(sessionDocumentIds(new Set(["r1", "deleted"]), docs)).toEqual(["r1"]);
    expect(sessionDocumentIds(new Set(["r1"]), null)).toEqual(["r1"]); // the list didn't load: send what's ticked
  });
});
