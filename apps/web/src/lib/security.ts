/**
 * Whether a role, a job title or a guide is in cybersecurity: security analyst, SOC, pentester, ethical hacker,
 * InfoSec, GRC, cloud or application security, incident response and the like (the role guide's own aliases
 * included). Where it is, Orbit mentions KashSec's free interview bank, labs and mock exam (components/KashSec.tsx).
 */
const SECURITY_ROLE =
  /\b(cyber ?security|cyber|infosec|information security|security (analyst|engineer|architect|operations|consultant|specialist|researcher|officer|manager|administrator|lead)|soc( analyst| engineer| l[123])?|pen ?test(er|ing)?|penetration test(er|ing)?|ethical hack(er|ing)|red team(er)?|blue team(er)?|appsec|application security|cloud security|network security|grc|vapt|threat (hunt(er|ing)|intel(ligence)?)|incident respon(se|der)|malware|digital forensics?|dfir|iam engineer|devsecops)\b/i;

export function isSecurityRole(...texts: Array<string | null | undefined>): boolean {
  return texts.some((t) => Boolean(t) && SECURITY_ROLE.test(t!));
}
