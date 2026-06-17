import { describe, it, expect } from "vitest";
import { languageIdForFile, languageLabel } from "./language";

describe("language detection", () => {
  it("maps .ts and .tsx to typescript", () => {
    expect(languageIdForFile("a.ts")).toBe("typescript");
    expect(languageIdForFile("a.tsx")).toBe("typescript");
  });
  it("maps .py to python", () => {
    expect(languageIdForFile("main.py")).toBe("python");
  });
  it("maps .go and .sh to their ids", () => {
    expect(languageIdForFile("main.go")).toBe("go");
    expect(languageIdForFile("run.sh")).toBe("shell");
  });
  it("falls back to plaintext for unknown extensions", () => {
    expect(languageIdForFile("notes.xyz")).toBe("plaintext");
  });
  it("provides a human label", () => {
    expect(languageLabel("typescript")).toBe("TypeScript");
    expect(languageLabel("plaintext")).toBe("Plain Text");
  });
});
