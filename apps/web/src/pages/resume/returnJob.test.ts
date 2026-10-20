import { expect, it } from "vitest";
import { resumeReturnJob } from "./returnJob";
it("accepts only a job identifier, never a return URL", () => {
  const id = "12345678-1234-1234-1234-123456789abc";
  expect(resumeReturnJob(`?guide=1&job=${id}`)).toBe(id);
  for (const value of ["https://evil.example", "//evil.example", "../admin", `${id}/extra`, "", "javascript:alert(1)"]) {
    expect(resumeReturnJob(`?job=${encodeURIComponent(value)}`)).toBeNull();
  }
});
