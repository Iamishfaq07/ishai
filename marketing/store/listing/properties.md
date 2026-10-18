# Properties page

Source: <https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/enter-app-properties>.

| Field | Value |
| --- | --- |
| Category | **Productivity**. Microsoft lists no subcategories for it. |
| Secondary category | **Education → Study aids**. Interview practice is learning. Leave it empty if the page doesn't offer it. |
| Privacy policy URL | `https://orbitanswer.com/privacy`. Required: the package declares the microphone, and Win32 apps "must always have privacy policies" (policy 10.5.1). The page already covers the Microsoft Store version. |
| Website | `https://orbitanswer.com` |
| Support contact info | `https://orbitanswer.com/contact` |
| Display mode | Leave as is (not a game). |

Why Productivity: Microsoft's own description of the field is "the most appropriate category … based on the features
and functionality it offers" (10.1.1). Orbit is a work tool used during calls. Business's subcategories (Legal + HR,
CRM and the rest) are for running a business, not for job seekers.

## Product declarations

| Declaration | Tick? | Why |
| --- | --- | --- |
| This product allows users to make purchases, but does not use the Microsoft Store commerce system | **Yes** | Packs and plans are sold on orbitanswer.com through Razorpay and PayPal. Policy 10.8.2: "You must note the use of a secure third-party purchase API in Partner Center during the submission process." |
| This product incorporates generative AI features | **Yes** | Answers, interview questions and reviews come from a cloud AI model. Policy 11.16 requires both this box and a note in the listing (the description's "AI-GENERATED CONTENT" section). |
| This product has been tested to meet accessibility guidelines | No | The web app was audited with axe; the Windows app hasn't had its own accessibility test yet. Tick it only after one. |
| Customers can install this product to alternate drives or removable storage | Default (yes) | Nothing in Orbit depends on the drive. |
| Windows can include this product's data in automatic backups to OneDrive | Default (yes) | Only window positions and settings are stored locally. The sign-in stays in Credential Manager. |
| This product supports pen and ink input | No | |

## System requirements

**Minimum hardware:** tick **Microphone**. The architecture (x64) comes from the package.

**Additional system requirements** (up to 11 items, 200 characters each):
- An internet connection
- A free Orbit account
- Windows 10 version 2004 or later, or Windows 11
