# Name

**Reserved in Partner Center (2026-10-18): `Orbit AI Career Assistant`.** Exact spelling and case.

The same string is used in three places:
- `displayName` in `apps/desktop/src-tauri/windows/msix/store-identity.json`;
- the package's display name and Start menu name (filled in by `scripts/package-msix.ps1`);
- the listing's product name.

The Store rejects a package whose display name isn't one of your reserved names.

| Field | Value |
| --- | --- |
| Product name (listing) | Orbit AI Career Assistant |
| Short name (Start tiles, `shortName`) | Orbit |
| Publisher display name (Product identity) | Orbitanswer |
| Package/Identity/Name | Orbitanswer.OrbitAICareerAssistant |

## Notes

**No "Copilot" anywhere in the name or title.** It's Microsoft's trademark (Microsoft Copilot is on the same Store).
The text says "interview assistant" instead.

**Policy 10.1.1** (<https://learn.microsoft.com/en-us/windows/apps/publish/store-policies>):

> Your product title or name must be unique and must not contain marketing or descriptive text, including
> extraneous use of keywords.

"Career Assistant" is descriptive. Many listings use a name like this and pass, and Microsoft let it be reserved.
If a reviewer cites 10.1.1 anyway, the fix is a plainer name, reserved in the same app (Product management → Manage
app names): **Orbit AI**, or **Orbit Answer** (it matches orbitanswer.com). Then update `displayName` and rebuild.

**Policy 10.14 (account type)**:

> A company account is required if [...] a reasonable consumer would interpret your application or publisher name to
> be that of a business entity.

The account is an individual one, and the publisher display name is "Orbitanswer", which reads like a business.
Microsoft's account guide also says individual accounts are for developers whose distribution is "not in relation to
their business, trade, or profession", while Orbit sells plans. See docs/MICROSOFT_STORE.md, "Risks", for what that
means and the options.
