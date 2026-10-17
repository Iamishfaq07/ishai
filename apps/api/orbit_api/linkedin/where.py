"""Where each suggestion goes on LinkedIn, and LinkedIn's limits for it.

The steps were checked against LinkedIn's Help Center on 2026-10-18 (the pages in `HELP`) and are kept generic, by
the names LinkedIn gives things ("the pencil icon in your intro", "Add profile section"), so a moved button doesn't
make them wrong. They're the desktop site's; the app's are close. Limits: LinkedIn's Help Center states the skills cap
(100) and the custom URL's rules (3-100 letters or numbers); the headline's 220 characters, About's 2,600 and a role
description's 2,000 are the limits LinkedIn's editor enforces and its own Talent Blog quotes, not Help Center text.
"""

HEADLINE_MAX = 220
ABOUT_MAX = 2_600
ROLE_MAX = 2_000
SKILLS_MAX = 100
URL_MIN, URL_MAX = 3, 100
TOP_SKILLS = 5  # the skills About can feature

WHERE: dict[str, list[str]] = {
    "headline": [
        "On LinkedIn, open your profile (Me → View profile).",
        "Click the pencil (Edit) icon in your intro, beside your photo.",
        "Replace the Headline with this, then Save.",
    ],
    "about": [
        "Open your profile and scroll to About.",
        "Click its pencil icon. No About yet: Add profile section → Core → Add about.",
        "Paste this in, then Save.",
    ],
    "experience": [
        "Open your profile, go to Experience and click Show all experiences.",
        "Click the pencil icon next to {role}.",
        "Replace the Description with this, then Save. Switch off \"Notify network\" first if you don't want an update "
        "sent.",
    ],
    "skills": [
        "To add one: open your profile → Add profile section → Core → Add skills, then search for it (one at a time).",
        "To put the top ones first: in Skills click the pencil, then More (…) → Reorder, and drag them up.",
        "If your About offers Top skills, pick the first five of these there.",
    ],
    "url": [
        "Open your profile and click Edit public profile & URL (on the right).",
        "Under Edit your custom URL, click the pencil, type the last part, then Save.",
        "3 to 100 letters or numbers, no spaces or symbols. You can change it 5 times in 6 months, so pick one to "
        "keep.",
    ],
    "featured": [
        "Open your profile → Add profile section → Recommended → Add featured.",
        "Click the + icon and choose a post, an article, a link or a file (image, document, slides).",
        "Give it the title below and a one-line description, then Save.",
    ],
    "photo": [
        "Open your profile. Click the camera icon in your intro (or your photo) to add or change your photo.",
        "Click the camera icon at the top right of your intro for the background image.",
        "Photo: at least 400 x 400 pixels. Background: 1584 x 396 pixels. JPG or PNG, under 8 MB.",
    ],
    "recommendation": [
        "Open their profile, click More, then Request a recommendation.",
        "Choose how you know each other and your position then, paste this message over LinkedIn's, then Send.",
        "Or from your own profile: Recommendations → + → Ask for a recommendation.",
    ],
    "open_to_work": [
        "Open your profile and click Open to → Finding a new job.",
        "Fill in the job titles, location types, locations, start date and employment types from this list.",
        "Choose who can see it, then Save.",
    ],
}

HELP: dict[str, str] = {
    "headline": "https://www.linkedin.com/help/linkedin/answer/a542926",
    "about": "https://www.linkedin.com/help/linkedin/answer/a553140",
    "experience": "https://www.linkedin.com/help/linkedin/answer/a593695",
    "skills": "https://www.linkedin.com/help/linkedin/answer/a549047",
    "url": "https://www.linkedin.com/help/linkedin/answer/a542685",
    "featured": "https://www.linkedin.com/help/linkedin/answer/a550399",
    "photo": "https://www.linkedin.com/help/linkedin/answer/a541850",
    "recommendation": "https://www.linkedin.com/help/linkedin/answer/a546682",
    "open_to_work": "https://www.linkedin.com/help/linkedin/answer/a507508",
}


def where(part: str, role: str = "") -> list[str]:
    return [step.replace("{role}", role or "the role") for step in WHERE.get(part, [])]
