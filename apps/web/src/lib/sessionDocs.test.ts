import { describe, expect, it } from "vitest";
import type { DocumentKind, DocumentStatus, OrbitDocument } from "@orbit/types";
import { MAX_SESSION_DOCUMENTS } from "@orbit/ui";
import { defaultSessionDocuments, restoredSessionDocuments, sessionDocumentIds, toggleSessionDocument } from "./sessionDocs";

const doc = (id: string, kind: DocumentKind, status: DocumentStatus = "ready"): OrbitDocument => ({
  id,
  title: id,
  kind,
  filename: null,
  size_bytes: 1,
  status,
  chunk_count: 1,
  created_at: "2026-10-01T00:00:00Z",
});

// Newest first, as GET /v1/documents lists them: 22 job descriptions saved by Jobs AI, then the resume.
const jobs = Array.from({ length: 22 }, (_, i) => doc(`jd-${i}`, "job_description"));
const many = [...jobs, doc("cv", "resume"), doc("cv-old", "resume"), doc("notes", "notes"), doc("cv-new", "resume", "processing")];

describe("live session documents", () => {
  it("ticks the ready resumes and job descriptions by default", () => {
    const docs = [doc("jd", "job_description"), doc("cv", "resume"), doc("notes", "notes"), doc("cv-2", "resume", "failed")];
    expect([...defaultSessionDocuments(docs)]).toEqual(["cv", "jd"]);
  });

  it("stays within the API's limit, keeping the newest resume and job description", () => {
    const picked = defaultSessionDocuments(many);
    expect(picked.size).toBe(MAX_SESSION_DOCUMENTS);
    expect(picked.has("cv")).toBe(true); // the newest ready resume, though 22 job descriptions are newer
    expect(picked.has("jd-0")).toBe(true);
    expect(picked.has("notes")).toBe(false);
    expect(picked.has("cv-new")).toBe(false); // not ready yet
  });

  it("refuses a tick past the limit, and always allows unticking", () => {
    const full = defaultSessionDocuments(many);
    expect(toggleSessionDocument(full, "jd-21")).toEqual(full);
    const fewer = toggleSessionDocument(full, "jd-0");
    expect(fewer.has("jd-0")).toBe(false);
    expect(toggleSessionDocument(fewer, "jd-21").has("jd-21")).toBe(true);
  });

  it("sends only documents that still exist, at most the limit", () => {
    const docs = [doc("cv", "resume"), doc("jd", "job_description")];
    expect(sessionDocumentIds(new Set(["cv", "gone", "jd"]), docs)).toEqual(["cv", "jd"]);
    const tooMany = new Set(many.map((d) => d.id));
    expect(sessionDocumentIds(tooMany, many)).toHaveLength(MAX_SESSION_DOCUMENTS);
    expect(sessionDocumentIds(new Set(["cv"]), null)).toEqual(["cv"]);
  });

  it("restores a saved setup's documents that still exist, at most the limit", () => {
    expect([...restoredSessionDocuments(["gone", "cv"], many)]).toEqual(["cv"]);
    expect(restoredSessionDocuments(many.map((d) => d.id), many).size).toBe(MAX_SESSION_DOCUMENTS);
  });
});
