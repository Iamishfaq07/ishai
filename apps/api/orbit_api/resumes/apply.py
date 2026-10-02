"""Suggestions applied on the server, exactly as the editor applies them (apps/web/src/pages/resume/model.ts), so a
fix can be checked before it's sent: apply it, re-score, and see whether the problem is gone."""

from orbit_api.resumes.fixes import Suggestion, current_skills, has_skill
from orbit_api.resumes.schema import ResumeData, SkillGroup

MAX_BULLETS = 12
MAX_SKILLS_PER_GROUP = 40


def get_at(data: ResumeData, path: str) -> str | None:
    """The text at a suggestion path ("basics.summary", "experience.<id>.bullets.2", "projects.<id>.description",
    "experience.<id>.start"), if it's there."""
    parts = path.split(".")
    if parts[0] == "basics" and len(parts) == 2:
        value = getattr(data.basics, parts[1], None)
        return value if isinstance(value, str) else None
    if parts[0] in ("experience", "projects") and len(parts) >= 3:
        items = data.experience if parts[0] == "experience" else data.projects
        item = next((x for x in items if x.id == parts[1]), None)
        if item is None:
            return None
        if parts[2] == "bullets" and len(parts) == 4 and parts[3].isdigit():
            i = int(parts[3])
            return item.bullets[i] if i < len(item.bullets) else None
        if parts[2] in ("description", "start", "end"):
            value = getattr(item, parts[2], None)
            return value if isinstance(value, str) else None
    return None


def set_at(data: ResumeData, path: str, value: str) -> ResumeData:
    """A copy of `data` with the text at `path` replaced; unknown paths leave it as it was."""
    if get_at(data, path) is None:
        return data
    out = data.model_copy(deep=True)
    parts = path.split(".")
    if parts[0] == "basics":
        setattr(out.basics, parts[1], value)
        return out
    items = out.experience if parts[0] == "experience" else out.projects
    item = next(x for x in items if x.id == parts[1])
    if parts[2] == "bullets":
        item.bullets[int(parts[3])] = value
    else:
        setattr(item, parts[2], value)
    return out


def add_skills(data: ResumeData, skills: list[str]) -> ResumeData:
    """Into a group called "Skills" (or the only group), else an "Additional skills" group: never repeating one."""
    have = current_skills(data)
    fresh: list[str] = []
    for s in skills:
        if s.strip() and not has_skill(have | {f.lower() for f in fresh}, s):
            fresh.append(s.strip())
    if not fresh:
        return data
    out = data.model_copy(deep=True)
    home = next((g for g in out.skills if g.name.strip().lower() == "skills"), None) or (
        out.skills[0] if len(out.skills) == 1 else None)
    if home is not None and len(home.items) + len(fresh) <= MAX_SKILLS_PER_GROUP:
        home.items += fresh
    else:
        name = "Additional skills" if out.skills else "Skills"
        extra = next((g for g in out.skills if g.name == name
                      and len(g.items) + len(fresh) <= MAX_SKILLS_PER_GROUP), None)
        if extra is not None:
            extra.items += fresh
        elif len(out.skills) < 10:
            out.skills.append(SkillGroup(name=name, items=fresh[:MAX_SKILLS_PER_GROUP]))
    return out


def can_apply(data: ResumeData, s: Suggestion) -> bool:
    if s.kind == "add_skill":
        return True
    if s.kind == "add_bullet":
        role = s.path.split(".")[1] if s.path.count(".") >= 2 else ""
        return any(e.id == role and len(e.bullets) < MAX_BULLETS for e in data.experience)
    return get_at(data, s.path) == s.before


def apply_suggestion(data: ResumeData, s: Suggestion) -> ResumeData:
    if not can_apply(data, s):
        return data
    if s.kind == "add_skill":
        return add_skills(data, [x.strip() for x in s.after.split(",")])
    if s.kind == "add_bullet":
        role = s.path.split(".")[1]
        out = data.model_copy(deep=True)
        for e in out.experience:
            if e.id == role and s.after not in e.bullets:
                e.bullets = [b for b in e.bullets if b.strip()] + [s.after]
        return out
    return set_at(data, s.path, s.after)
