# Release review: seven pillars (1st review)

Use for every release's 1st review (Fable reviewer agent). The 2nd gate uses the same finding format. A repo may override this file with its own `docs/superpowers/specs/audits/*seven-pillar*.md`.

## Pillars

Review the release diff (`<BASE_SHA>..HEAD`) and the code paths it touches against each pillar. Pillar 7 checks standards and peers.

1. **Security: protocol and token layer.** auth flows, tokens, sessions handoff, redirects, logout, external protocols.
2. **Security: identity, authorization and data.** Authentication, MFA, sessions, authorization, tenant isolation, provisioning, secrets at rest.
3. **Code review and reliability.** Correctness, races, transactions, error handling, HA/cluster behaviour, migrations, rollback paths.
4. **UI quality and performance.** Views, CSS/JS, assets, caching, response size, mobile 390 px, dark/light.
5. **Usability and accessibility.** WCAG 2.1 AA, keyboard, labels, errors tied to inputs, en/id i18n parity, plain wording.
6. **Completeness and operations.** The plan's tasks are fully done; docs match the code; deploy files (compose, systemd, images) work as written; upgrade notes.
7. **Security, standards and best practice.** Check the diff against the primary standards in the five areas below, and against how the leading peer products in the same domain do it. Cite the clause.
   - **7A Authentication & MFA:** NIST SP 800-63B-4, OWASP ASVS 5.0 V6, WebAuthn L3, RFC 6238.
   - **7B Federation & tokens:** RFC 9700, OIDC Core/Discovery/Logout, FAPI 2.0, RFC 9126/9449/8705/8252/9207/7523, SAML 2.0 security.
   - **7C Sessions, authorization, tenancy & admin plane:** NIST SP 800-53 AC/AU, ASVS V3/V7/V8, OWASP cheat sheets (Session, Authorization, CSRF, Headers, Multi-Tenant).
   - **7D Crypto, keys, audit & privacy:** NIST SP 800-57/38D/92, FIPS 140-3, RFC 8725, GDPR / UU PDP 27/2022.
   - **7E Supply chain, RADIUS & hardening:** NIST SSDF, SLSA v1.0, OpenSSF Scorecard, CIS Docker/systemd, RFC 2865/5176/6614/9765, Blast-RADIUS mitigations.

## Finding format (MANDATORY, both reviews)

Every finding must be self-contained and fixable without asking a follow-up question:

`ID | severity | pillar | path:line | WRONG | EXPECTED | FIX | TEST`

- **path:line:** the exact file and line, or line range, of the defect. Not a package, not "somewhere in".
- **WRONG:** one concrete failure with inputs and outcome.
- **EXPECTED:** the observable correct behaviour, for example a status code, error string, DB state or log line.
- **FIX:** the exact change. Give the function name, the condition or statement to add, change or remove, and EVERY other file the fix must touch (tests, docs, config, migrations, i18n keys). Never write "consider", "maybe", "could", "should look into", "review whether" or "as appropriate". If two fixes are valid, pick one and say why in one line.
- **TEST:** the exact test name plus the assertion that proves EXPECTED.
- **Evidence:** quote the decisive code line, or line range, in backticks.
- **Standard (pillar 7):** cite the clause with its URL and section.
- **No duplicates:** one finding per root cause. List all affected sites in that finding's FIX.
- **Owner decisions:** do not re-raise anything the constraints file records as an owner decision.
- **No placeholder:** never report a finding without a FIX and a TEST. Drop it instead.
- **End line:** end with `totals: C=<n> H=<n> M=<n> L=<n>`, or `No issues.`.
