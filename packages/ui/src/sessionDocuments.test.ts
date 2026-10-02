import { describe, expect, it } from "vitest";
import type { DocumentKind, DocumentStatus, OrbitDocument } from "@orbit/types";
import { MAX_SESSION_DOCUMENTS, practiceDocumentIds } from "./sessionDocuments";

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

describe("practice session documents", () => {
  it("sends the ready resumes and only the chosen job description", () => {
    const docs = [
      doc("cv", "resume"),
      doc("cv-old", "resume", "processing"),
      doc("jd-a", "job_description"),
      doc("jd-b", "job_description"),
      doc("notes", "notes"),
    ];
    expect(practiceDocumentIds(docs, "jd-b")).toEqual(["jd-b", "cv"]);
    expect(practiceDocumentIds(docs, null)).toEqual(["cv"]);
    expect(practiceDocumentIds(docs, "cv")).toEqual(["cv"]); // not a job description: ignored
  });

  it("stays within the API's limit, keeping the job description", () => {
    const many = [
      ...Array.from({ length: 30 }, (_, i) => doc(`jd-${i}`, "job_description")),
      ...Array.from({ length: 25 }, (_, i) => doc(`cv-${i}`, "resume")),
    ];
    const ids = practiceDocumentIds(many, "jd-29");
    expect(ids).toHaveLength(MAX_SESSION_DOCUMENTS);
    expect(ids[0]).toBe("jd-29");
    expect(ids.filter((id) => id.startsWith("jd-"))).toEqual(["jd-29"]);
  });
});
