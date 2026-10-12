import { describe, expect, it } from "vitest";
import {
  SIGNUP_MESSAGES,
  getArabicAuthError,
  getPasswordRequirements,
  validateSignupEmail,
  validateSignupPassword,
} from "@/lib/signup-validation";

describe("validateSignupEmail", () => {
  it("accepts a university email", () => {
    expect(validateSignupEmail("  s4410000@uqu.edu.sa ")).toBeNull();
  });
  it.each(["", "   ", "no-at-sign", "a@b", "a b@c.com"])("rejects %j", (e) => {
    expect(validateSignupEmail(e)).toBe(SIGNUP_MESSAGES.invalidEmail);
  });
});

describe("validateSignupPassword", () => {
  it("accepts a strong password", () => {
    expect(validateSignupPassword("Faten2026x")).toEqual({ ok: true });
  });
  it.each([
    ["Ab1", SIGNUP_MESSAGES.passwordTooShort],
    ["faten2026x", SIGNUP_MESSAGES.passwordNoUppercase],
    ["FATEN2026X", SIGNUP_MESSAGES.passwordNoLowercase],
    ["FatenFaten", SIGNUP_MESSAGES.passwordNoNumber],
  ])("rejects %j", (pw, message) => {
    expect(validateSignupPassword(pw)).toEqual({ ok: false, message });
  });
});

describe("getPasswordRequirements", () => {
  it("reports each rule in a stable order", () => {
    const reqs = getPasswordRequirements("abc");
    expect(reqs.map((r) => r.id)).toEqual(["length", "uppercase", "lowercase", "number"]);
    expect(reqs.map((r) => r.met)).toEqual([false, false, true, false]);
  });
});

describe("getArabicAuthError", () => {
  it("does not reveal whether the account exists", () => {
    const a = getArabicAuthError({ code: "auth/user-not-found" });
    const b = getArabicAuthError({ code: "auth/wrong-password" });
    expect(a).toBe(b);
  });
  it("falls back to an Arabic message for unknown errors", () => {
    expect(getArabicAuthError(new Error("boom"))).toMatch(/[؀-ۿ]/);
  });
});
