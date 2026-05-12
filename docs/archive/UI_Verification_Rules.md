# Verification Rules

Use these rules for any AI-assisted verification, especially UI fixes.

## Purpose

Prevent false verification caused by stale app instances, cached browser state, or mixed pre-fix / post-fix observations.

---

## 1. Source of truth

- Git commit state is the source of truth for code.
- A running app instance is **not** trusted by default.
- UI verification is valid only if runtime freshness is proven.

---

## 2. Fresh-runtime rule

Before verifying any UI change, the verifier must prove the runtime is current.

Acceptable proof:
1. Restart the app from the current repo state, **or**
2. Verify a unique changed string/value that could only appear after the latest commit.

If freshness cannot be proven, stop and report:

> Verification is not reliable; app instance may be stale.

---

## 3. Commit-aware verification

Every verification must report:

- current branch
- latest commit hash
- exact surface checked
- exact expected text/value
- exact observed text/value

If the observed UI cannot be tied to the current commit, the verification is provisional only.

---

## 4. UI verification standard

For operator-facing UI fixes, do not report general impressions.

Report only:

- **Surface:** where the check happened
- **Expected:** exact text/value that should appear
- **Observed:** exact text/value actually shown
- **Result:** pass / fail

Example:

- Surface: Home → session posture line
- Expected: `Session posture: REPLAY only — review and investigation. DRY_RUN and LIVE blocked until certification passes.`
- Observed: `Session posture: REPLAY only — review and investigation. DRY_RUN and LIVE blocked until certification passes.`
- Result: pass

---

## 5. No mixed-state reasoning

Do not combine:
- pre-fix observations
- post-fix observations
- cached browser state
- stale server output

A conclusion is invalid if it mixes different runtime states.

---

## 6. Multi-tool comparison rule

If two tools are used to verify the same fix, both must confirm the same anchor string/value.

If one tool does not explicitly confirm the anchor, its conclusion is not trusted.

---

## 7. Behavioral conclusions come last

Do not conclude:
- "system works"
- "friction remains"
- "fix failed"
- "fix succeeded"

until runtime freshness has been proven and the anchor strings/values have been checked.

---

## 8. Operator-trust rule

For operator-facing fixes, verification must prioritize the exact user-visible message/state, not inferred behavior.

Prefer:
- exact wording
- exact badge value
- exact status label

over broad interpretation.

---

## 9. Default failure mode

If there is uncertainty, the verifier must fail safe:

> Runtime state uncertain. Re-verify on a fresh instance.

---

## 10. Practical workflow

1. Make the fix
2. Record changed file and expected UI change
3. Prove fresh runtime
4. Check exact anchor string/value
5. Then conclude whether the fix is live
