"""How well-known companies interview: a small, hand-written guide used by the mock interviewer, the live copilot and
the Practice page's "What to expect".

Each entry is what candidates commonly report and what the company says publicly about what it looks for (values,
principles, round types), kept general on purpose: rounds change by team, level and year, so nothing here is a
promise of a specific process. Matching is by name or a common alias ("AWS" is Amazon, "Tata Consultancy" is TCS).
"""

import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class CompanyStyle:
    slug: str
    name: str
    aliases: tuple[str, ...]
    # The rounds candidates commonly report, in order, one short line each.
    rounds: tuple[str, ...]
    # What the interviewers are listening for: the company's stated values or principles, as they're probed.
    looks_for: tuple[str, ...]
    # Questions in the company's style, asked as written when the model is unavailable.
    questions: tuple[str, ...]
    tips: tuple[str, ...] = field(default_factory=tuple)


STYLES: tuple[CompanyStyle, ...] = (
    CompanyStyle(
        "amazon", "Amazon", ("aws", "amazon web services", "amazon india", "amazon development centre"),
        rounds=("Online assessment (coding and work-style questions)", "Phone screen",
                "Loop of 4–5 interviews, each covering technical work and two or three Leadership Principles",
                "A 'Bar Raiser' from another team in the loop"),
        looks_for=("Customer Obsession", "Ownership", "Dive Deep", "Bias for Action", "Deliver Results",
                   "Earn Trust", "Are Right, A Lot", "Insist on the Highest Standards", "Disagree and Commit"),
        questions=("Tell me about a time you went well beyond what a customer asked for.",
                   "Tell me about a time you had to make a decision quickly without all the data.",
                   "Tell me about a time you disagreed with your manager. What happened?",
                   "Describe a time you dug into the details to find the root cause of a problem.",
                   "Tell me about a commitment you failed to deliver. What did you learn?"),
        tips=("Prepare two stories per Leadership Principle; one story can't cover the whole loop.",
              "Expect several follow-ups on one story: your exact part, the data, what you'd do differently.",
              "Say \"I\", give numbers, and end each story on the result."),
    ),
    CompanyStyle(
        "google", "Google", ("alphabet", "google india", "youtube", "deepmind", "google cloud"),
        rounds=("Recruiter call", "One or two technical phone screens (coding in a shared doc)",
                "Onsite or virtual loop: coding, system design (for experienced roles), and a "
                "'Googleyness and leadership' interview", "Hiring committee review"),
        looks_for=("General cognitive ability: how you reason through an open problem",
                   "Role-related knowledge", "Leadership: stepping up without authority",
                   "Googleyness: comfort with ambiguity, collaboration, doing the right thing"),
        questions=("Tell me about a time you had to work through a problem with no clear owner or direction.",
                   "How would you estimate how many people use Google Maps on a weekday morning in Bengaluru?",
                   "Tell me about a time you helped a teammate who was struggling.",
                   "Walk me through the hardest technical decision you've made and the trade-offs you weighed."),
        tips=("Think out loud: they score how you reason, not only the answer.",
              "State assumptions, then test them; ask clarifying questions before you dive in.",
              "For coding, talk through complexity and edge cases before you write."),
    ),
    CompanyStyle(
        "microsoft", "Microsoft", ("msft", "microsoft india", "microsoft idc", "linkedin", "github"),
        rounds=("Recruiter screen", "Online assessment or phone screen",
                "Loop of 3–4 interviews mixing coding, design and behavioral questions",
                "Final 'as appropriate' interview with a senior leader"),
        looks_for=("Growth mindset: learning from mistakes and feedback", "Collaboration across teams",
                   "Customer focus", "Problem solving and clear communication", "Inclusive behaviour"),
        questions=("Tell me about a time you got critical feedback. What did you change?",
                   "Describe a time you learned something new quickly to deliver a project.",
                   "Tell me about a time you worked with a team that disagreed on the approach.",
                   "Design a parking-lot system. Where would you start?"),
        tips=("Show how you learn: what you tried, what failed, what you'd do now.",
              "Expect a design question even in coding rounds; clarify requirements first."),
    ),
    CompanyStyle(
        "meta", "Meta", ("facebook", "instagram", "whatsapp", "meta platforms"),
        rounds=("Recruiter call", "Technical screen (two coding problems)",
                "Onsite loop: coding, system or product design, and a behavioral interview"),
        looks_for=("Moving fast with good judgement", "Impact: what changed because of your work",
                   "Handling conflict directly and respectfully", "Growing others and yourself"),
        questions=("Tell me about the project with the most impact you've worked on. How did you measure it?",
                   "Tell me about a time you had a conflict with a coworker. How did you resolve it?",
                   "Tell me about a time you had to move fast and cut scope. What did you leave out and why?"),
        tips=("Lead with impact and numbers.", "Coding rounds are fast: two problems in about 40 minutes."),
    ),
    CompanyStyle(
        "flipkart", "Flipkart", ("myntra", "phonepe group", "flipkart india", "cleartrip"),
        rounds=("Online coding assessment", "Machine coding round (build a small working system in 90–120 minutes)",
                "Problem solving / data structures round", "System design (for experienced roles)",
                "Hiring manager round"),
        looks_for=("Clean, extensible, working code", "Problem solving under time pressure",
                   "Ownership and bias for action", "Customer-first thinking"),
        questions=("Walk me through how you'd design a simple parking-lot or snake-and-ladder system in code.",
                   "Tell me about a time you owned a problem end to end.",
                   "How would you design the cart and checkout flow for a big sale day?"),
        tips=("Practise machine coding: working code first, then clean classes and tests.",
              "Talk about scale: Big Billion Days traffic is a favourite topic."),
    ),
    CompanyStyle(
        "tcs", "TCS", ("tata consultancy services", "tata consultancy", "tcs digital", "tcs ninja", "tcs nqt"),
        rounds=("TCS NQT (aptitude, reasoning, verbal and coding)", "Technical interview",
                "Managerial interview", "HR interview"),
        looks_for=("Fundamentals: OOP, DBMS, a programming language, your final-year project",
                   "Clear communication", "Willingness to relocate and work in shifts",
                   "Learning attitude and teamwork"),
        questions=("Tell me about yourself.", "Explain your final-year project and your part in it.",
                   "What is the difference between an abstract class and an interface?",
                   "Are you willing to relocate and work in any shift?", "Why do you want to join TCS?"),
        tips=("Know your project inside out: they'll ask what you built yourself.",
              "Revise OOP, DBMS and SQL basics; expect one or two simple coding questions.",
              "Answer HR questions honestly and briefly; relocation and bond questions are common."),
    ),
    CompanyStyle(
        "infosys", "Infosys", ("infosys limited", "infy", "infosys bpm", "hackwithinfy", "infytq"),
        rounds=("Online test (aptitude, reasoning, verbal, pseudocode or coding)", "Technical interview",
                "HR interview"),
        looks_for=("Programming and CS fundamentals", "Your projects and internships",
                   "Communication", "Learnability and flexibility"),
        questions=("Tell me about yourself.", "Which programming language are you most comfortable in, and why?",
                   "Explain normalization in databases with an example.",
                   "Why Infosys?", "Where do you see yourself in five years?"),
        tips=("Keep 'tell me about yourself' to a minute: education, project, skills, why this role.",
              "Expect questions on whatever you wrote on your resume, so only list what you can explain."),
    ),
    CompanyStyle(
        "wipro", "Wipro", ("wipro limited", "wipro elite", "wipro nlth", "wipro turbo"),
        rounds=("Online assessment (aptitude, written communication essay, coding)", "Technical interview",
                "HR interview"),
        looks_for=("Fundamentals and coding basics", "Written and spoken communication",
                   "Flexibility on location and shifts", "Integrity and teamwork"),
        questions=("Tell me about yourself.", "Explain the four pillars of object-oriented programming.",
                   "Tell me about a challenge you faced in a team project.", "Why should we hire you?"),
        tips=("Practise a short essay: the written test checks grammar and structure.",
              "Have a clear two-minute walkthrough of your best project."),
    ),
    CompanyStyle(
        "accenture", "Accenture", ("accenture india", "accenture solutions"),
        rounds=("Cognitive and technical assessment", "Coding assessment", "Communication assessment (spoken English)",
                "Interview (technical and HR together)"),
        looks_for=("Communication and client-readiness", "Technical basics", "Adaptability",
                   "Teamwork and learning"),
        questions=("Tell me about yourself.", "Tell me about a time you worked in a team to meet a deadline.",
                   "What do you know about Accenture?", "How do you keep learning new technologies?"),
        tips=("Speak clearly and at an even pace: there's a separate spoken-English test.",
              "Read Accenture's recent work in your area before the interview."),
    ),
    CompanyStyle(
        "cognizant", "Cognizant", ("cts", "cognizant technology solutions", "genc", "genc next", "genc elevate"),
        rounds=("Online assessment (aptitude and coding)", "Technical interview", "HR interview"),
        looks_for=("Fundamentals: OOP, DBMS, SQL, a language", "Your projects", "Communication",
                   "Willingness to learn and relocate"),
        questions=("Tell me about yourself.", "Write a SQL query to find the second-highest salary.",
                   "Explain your project's architecture.", "Are you comfortable relocating?"),
        tips=("Revise SQL joins and simple queries.", "Be ready to explain every technology on your resume."),
    ),
    CompanyStyle(
        "deloitte", "Deloitte", ("deloitte india", "deloitte usi", "deloitte consulting"),
        rounds=("Online assessment", "Group discussion (some campus roles)", "Technical or case interview",
                "Partner / HR interview"),
        looks_for=("Structured thinking", "Client-facing communication", "Business awareness",
                   "Teamwork and integrity"),
        questions=("Tell me about yourself.", "A client's sales dropped 20% this quarter. How would you find out why?",
                   "Tell me about a time you persuaded someone who disagreed with you.",
                   "Why consulting, and why Deloitte?"),
        tips=("Structure answers out loud: 'I'd look at three things…'.",
              "For case questions, ask clarifying questions before you answer."),
    ),
    CompanyStyle(
        "goldman-sachs", "Goldman Sachs", ("goldman", "goldman sachs india"),
        rounds=("Online assessment (coding, maths, aptitude)", "Technical interviews: data structures, problem solving",
                "'Superday': several back-to-back interviews including behavioral and fit"),
        looks_for=("Strong problem solving and maths", "Attention to detail", "Teamwork under pressure",
                   "Integrity and client focus"),
        questions=("Tell me about a time you worked under real pressure. What did you do?",
                   "Why Goldman Sachs, and why this division?",
                   "Tell me about a mistake you caught before it reached anyone else."),
        tips=("Expect probability and puzzle questions alongside coding.",
              "Know why this division specifically, not just why finance."),
    ),
    CompanyStyle(
        "razorpay", "Razorpay", ("razorpay india", "razorpayx"),
        rounds=("Recruiter screen", "Coding or machine coding round", "System design (for experienced roles)",
                "Hiring manager and culture round"),
        looks_for=("Ownership", "Customer (merchant) focus", "Transparency", "Building for scale and reliability"),
        questions=("Tell me about a production issue you owned. What did you change afterwards?",
                   "How would you design a payment retry system that never charges a customer twice?",
                   "Why Razorpay?"),
        tips=("Payments care about correctness: talk about idempotency, retries and failure modes.",),
    ),
    CompanyStyle(
        "swiggy", "Swiggy", ("swiggy instamart", "bundl technologies"),
        rounds=("Online coding assessment", "Problem solving / data structures", "Machine coding or low-level design",
                "System design (for experienced roles)", "Hiring manager round"),
        looks_for=("Problem solving", "Ownership and speed", "Consumer focus", "Designing for real-time scale"),
        questions=("How would you design order tracking for a food-delivery app?",
                   "Tell me about a time you shipped something fast. What trade-offs did you make?",
                   "Tell me about a feature you built that users loved."),
        tips=("Real-time systems (tracking, dispatch, ETAs) are favourite design topics.",),
    ),
    CompanyStyle(
        "zomato", "Zomato", ("blinkit", "zomato india"),
        rounds=("Coding assessment", "Problem solving / data structures", "Design round",
                "Hiring manager / founder's office round (some roles)"),
        looks_for=("Ownership", "Speed of execution", "Customer obsession", "First-principles thinking"),
        questions=("How would you design a system to show restaurants near a user, sorted by delivery time?",
                   "Tell me about something you built because you thought it should exist.",
                   "What would you improve in the Zomato app, and how would you measure it?"),
        tips=("Have a product opinion about their app.",),
    ),
    CompanyStyle(
        "apple", "Apple", ("apple inc",),
        rounds=("Recruiter screen", "One or two phone or video interviews with the team",
                "Onsite or virtual loop with several team members, often including the hiring manager"),
        looks_for=("Deep expertise in your area", "Attention to detail and quality",
                   "Caring about the user's experience", "Collaboration across teams", "Discretion"),
        questions=("Tell me about a product you love and what you'd change about it.",
                   "Walk me through the work you're proudest of, in detail.",
                   "Tell me about a time you pushed back on a decision because quality would suffer."),
        tips=("Go deep: expect follow-ups several levels into your own projects.",
              "Show you care about the details users notice."),
    ),
    CompanyStyle(
        "netflix", "Netflix", ("netflix inc",),
        rounds=("Recruiter screen", "Hiring manager interview", "Technical or functional interviews",
                "Interviews on the culture: judgement, candor and how you work"),
        looks_for=("Judgement", "Candor: giving and taking direct feedback", "Courage", "Ownership with freedom",
                   "High performance on a team"),
        questions=("Tell me about a time you gave someone difficult feedback.",
                   "Tell me about a decision you made without asking for permission. How did it go?",
                   "What feedback have you received that changed how you work?"),
        tips=("Read the Netflix culture memo before the interview.",
              "Be direct and specific; they value candor over polish."),
    ),
    CompanyStyle(
        "uber", "Uber", ("uber technologies", "uber eats"),
        rounds=("Recruiter screen", "Technical phone screen", "Onsite loop: coding, system design and a "
                "collaboration / behavioral interview", "Hiring manager interview"),
        looks_for=("Problem solving at scale", "Ownership", "Collaboration", "Customer focus",
                   "Clear communication of trade-offs"),
        questions=("How would you design the matching of riders to drivers in a busy city?",
                   "Tell me about a time you owned a problem outside your role.",
                   "Tell me about a time you had to make a trade-off between speed and quality."),
        tips=("Real-time, location-based systems are favourite design topics.",),
    ),
    CompanyStyle(
        "stripe", "Stripe", ("stripe inc",),
        rounds=("Recruiter screen", "Technical screen with practical coding", "Onsite: practical coding (debugging, "
                "building against an API), system design, and behavioral interviews"),
        looks_for=("Rigorous thinking", "Users first", "Moving with urgency", "Clear written and spoken communication",
                   "Practical, working code"),
        questions=("Tell me about a bug you tracked down that others couldn't.",
                   "How would you design an API that lets businesses refund a payment safely?",
                   "Tell me about a time you did more for a user than your role asked."),
        tips=("Practise practical tasks (reading code, fixing bugs, calling an API), not just puzzles.",
              "Talk about correctness: idempotency and failure modes matter in payments."),
    ),
    CompanyStyle(
        "salesforce", "Salesforce", ("salesforce com", "slack", "tableau", "mulesoft"),
        rounds=("Recruiter screen", "Hiring manager interview", "Technical or functional panel",
                "A presentation or case in some roles"),
        looks_for=("Trust", "Customer success", "Innovation", "Equality", "Sustainability"),
        questions=("Tell me about a time you turned around an unhappy customer.",
                   "How have you built trust with a team that was new to you?",
                   "Tell me about something new you introduced at work."),
        tips=("Connect your stories to Salesforce's core values.",),
    ),
    CompanyStyle(
        "ibm", "IBM", ("ibm india", "international business machines", "red hat"),
        rounds=("Online assessment (cognitive and coding tests)", "Technical interview", "Manager / HR interview"),
        looks_for=("Dedication to every client's success", "Innovation that matters",
                   "Trust and personal responsibility", "Learning and adaptability"),
        questions=("Tell me about yourself.", "Tell me about a time you learned a new technology for a project.",
                   "How would you explain a technical idea to a client who isn't technical?"),
        tips=("Be ready for game-style cognitive tests in the assessment.",),
    ),
    CompanyStyle(
        "jpmorgan", "JPMorgan Chase", ("jpmorgan", "jp morgan", "j p morgan", "jpmc", "chase"),
        rounds=("Online application and assessments", "Recorded video interview (HireVue)",
                "'Superday' of back-to-back interviews, technical and behavioral"),
        looks_for=("Client focus", "Teamwork", "Integrity", "Problem solving", "Resilience under pressure"),
        questions=("Why JPMorgan, and why this business?", "Tell me about a time you worked under pressure.",
                   "Tell me about a time you made a mistake. How did you fix it?"),
        tips=("Practise recorded answers: the video round is timed and has no interviewer.",
              "Know the business line you're applying to."),
    ),
    CompanyStyle(
        "mckinsey", "McKinsey", ("mckinsey and company", "mckinsey company", "mckinsey co"),
        rounds=("Problem-solving assessment (a digital game)", "First round: case interviews with a personal "
                "experience interview", "Final round: more case and personal experience interviews"),
        looks_for=("Structured problem solving", "Personal impact", "Entrepreneurial drive", "Inclusive leadership",
                   "Courageous change"),
        questions=("Tell me about a time you persuaded someone who disagreed with you.",
                   "Our client's profits fell 15% this year. How would you work out why?",
                   "Tell me about a time you led a team through a difficult situation."),
        tips=("Structure every case answer out loud before you solve it.",
              "Prepare one deep story per personal experience theme; they'll probe it for 10–15 minutes."),
    ),
    CompanyStyle(
        "atlassian", "Atlassian", ("atlassian india", "trello", "jira"),
        rounds=("Recruiter screen", "Technical interviews: coding and system design",
                "A values interview", "Hiring manager / management interview"),
        looks_for=("Open company, no nonsense", "Build with heart and balance", "Don't let the customer down",
                   "Play, as a team", "Be the change you seek"),
        questions=("Tell me about a time you shared bad news openly.",
                   "Tell me about a time you balanced speed with doing it right.",
                   "Tell me about something you changed for the better at work."),
        tips=("The values interview carries real weight: prepare a story for each value.",),
    ),
    CompanyStyle(
        "shopify", "Shopify", ("shopify inc",),
        rounds=("Recruiter screen", "'Life story' conversation about your path and choices",
                "Technical interviews, often pair programming", "Team or lead interview"),
        looks_for=("Thriving on change", "Building for merchants", "Ownership", "Learning fast"),
        questions=("Walk me through your life story: the big choices and why you made them.",
                   "Tell me about a time things changed fast at work. What did you do?",
                   "Who are Shopify's merchants, and what would you build for them?"),
        tips=("For the life-story round, explain why you made each choice, not just what you did.",),
    ),
)

_BY_KEY: dict[str, CompanyStyle] = {}


def _key(name: str) -> str:
    """'Tata Consultancy Services Ltd.' → 'tata consultancy services'."""
    words = re.findall(r"[a-z0-9]+", name.lower())
    while words and words[-1] in ("ltd", "limited", "inc", "pvt", "private", "llc", "corp", "corporation", "co"):
        words.pop()
    return " ".join(words)


for _s in STYLES:
    for _n in (_s.name, _s.slug.replace("-", " "), *_s.aliases):
        _BY_KEY[_key(_n)] = _s


def match(company: str | None) -> CompanyStyle | None:
    """The guide for the company, by its name or a common alias, or None when there isn't one."""
    if not company:
        return None
    key = _key(company)
    if not key:
        return None
    if key in _BY_KEY:
        return _BY_KEY[key]
    # "Amazon (AWS)", "Google Cloud India": a known name as the leading words.
    words = key.split()
    for n in range(len(words) - 1, 0, -1):
        hit = _BY_KEY.get(" ".join(words[:n]))
        if hit is not None:
            return hit
    return None


def interviewer_brief(style: CompanyStyle) -> str:
    """For the mock interviewer: interview the way this company does."""
    return (f"Interview the way {style.name} does. Its interviewers listen for: {'; '.join(style.looks_for)}. "
            f"Rounds candidates report: {'; '.join(style.rounds)}. Ask questions that test those, in that style "
            "(for example: " + " / ".join(style.questions[:2]) + "), and don't name the value you're testing.")


def copilot_hint(style: CompanyStyle) -> str:
    """For the live copilot: what this company's interviewers listen for, so an answer can show it."""
    return (f"{style.name}'s interviewers listen for: {'; '.join(style.looks_for)}. Where it fits naturally, let the "
            "answer show the one this question tests; never name it or recite a value.")
