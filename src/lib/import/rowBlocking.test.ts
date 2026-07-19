import { describe, expect, it } from "vitest";
import { blockingReason, isRowBlocking } from "./rowBlocking";

describe("isRowBlocking / blockingReason", () => {
  it("blocks an ambiguous club with no override", () => {
    const row = { status: "ERROR", clubMatchType: "AMBIGUOUS", overrideClubId: null, overrideClubName: null };
    expect(isRowBlocking(row)).toBe(true);
    expect(blockingReason(row)).toBe("ambiguousClub");
  });

  it("does not block an ambiguous club once an override club is picked, even though status is still stale ERROR", () => {
    const row = { status: "ERROR", clubMatchType: "AMBIGUOUS", overrideClubId: "club-1", overrideClubName: null };
    expect(isRowBlocking(row)).toBe(false);
    expect(blockingReason(row)).toBeNull();
  });

  it("does not block an ambiguous club once it's named as a genuinely different new club", () => {
    // Regression: an admin saving a name for an AMBIGUOUS row (rather than picking
    // an existing club) used to be silently ignored -- the row stayed blocked
    // forever even though the admin had resolved it.
    const row = { status: "ERROR", clubMatchType: "AMBIGUOUS", overrideClubId: null, overrideClubName: "Dallas Skyline" };
    expect(isRowBlocking(row)).toBe(false);
    expect(blockingReason(row)).toBeNull();
  });

  it("blocks a new club with no name or override", () => {
    const row = { status: "WARNING", clubMatchType: "NEW", overrideClubId: null, overrideClubName: null };
    expect(isRowBlocking(row)).toBe(true);
    expect(blockingReason(row)).toBe("unnamedNewClub");
  });

  it("does not block a new club once a name is saved, even though status is still stale WARNING", () => {
    const row = { status: "WARNING", clubMatchType: "NEW", overrideClubId: null, overrideClubName: "Some Club" };
    expect(isRowBlocking(row)).toBe(false);
    expect(blockingReason(row)).toBeNull();
  });

  it("does not block a new club once an existing club override is picked instead of a name", () => {
    const row = { status: "WARNING", clubMatchType: "NEW", overrideClubId: "club-1", overrideClubName: null };
    expect(isRowBlocking(row)).toBe(false);
  });

  it("blocks a generic ERROR row (e.g. malformed code, duplicate-in-batch) regardless of overrides", () => {
    const row = { status: "ERROR", clubMatchType: "EXISTING", overrideClubId: null, overrideClubName: null };
    expect(isRowBlocking(row)).toBe(true);
    expect(blockingReason(row)).toBe("error");
  });

  it("does not block an OK or WARNING row with no club issue", () => {
    const ok = { status: "OK", clubMatchType: "EXISTING", overrideClubId: null, overrideClubName: null };
    const warning = { status: "WARNING", clubMatchType: "EXISTING", overrideClubId: null, overrideClubName: null };
    expect(isRowBlocking(ok)).toBe(false);
    expect(isRowBlocking(warning)).toBe(false);
  });

  it("never double-counts: an ambiguous row's reason is exactly one bucket, not error+ambiguous", () => {
    const row = { status: "ERROR", clubMatchType: "AMBIGUOUS", overrideClubId: null, overrideClubName: null };
    const reason = blockingReason(row);
    expect(reason).toBe("ambiguousClub");
    expect(reason).not.toBe("error");
  });
});
