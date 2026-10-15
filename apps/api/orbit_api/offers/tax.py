"""What an Indian offer pays into the bank each month: the fixed pay, less what a CTC counts that never reaches the
account (the employer's PF and gratuity), the employee's PF, professional tax and income tax under the new regime
(FY 2026-27: Budget 2026 kept FY 2025-26's slabs). An estimate, and the page says so: the real split of basic,
allowances and PF is in the offer letter, and the old regime or HRA can change it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

STANDARD_DEDUCTION = 75_000
REBATE_LIMIT = 1_200_000  # taxable income up to this pays no tax (section 87A)
SLABS = ((400_000, 0.0), (800_000, 0.05), (1_200_000, 0.10), (1_600_000, 0.15), (2_000_000, 0.20),
         (2_400_000, 0.25), (float("inf"), 0.30))
SURCHARGE = ((5_000_000, 0.0), (10_000_000, 0.10), (20_000_000, 0.15), (float("inf"), 0.25))  # capped at 25% (new)
CESS = 0.04
PROFESSIONAL_TAX = 2_500  # a year; most states charge ₹2,400-2,500, a few none
BASIC_SHARE = 0.5  # the labour codes (Nov 2025): wages are at least half of pay
PF_RATE = 0.12
PF_WAGE_CAP = 15_000  # a month: PF on capped wages is ₹1,800 a month
GRATUITY_RATE = 0.0481

PfMode = Literal["capped", "full", "none"]


def _slab_tax(taxable: float) -> float:
    tax, floor = 0.0, 0.0
    for top, rate in SLABS:
        if taxable > floor:
            tax += (min(taxable, top) - floor) * rate
        floor = top
    return tax


def income_tax(taxable: float) -> float:
    """New-regime tax on a year's taxable income, with the 87A rebate, its marginal relief (just over ₹12 lakh, the
    tax can't be more than the income over it), the surcharge and the 4% cess."""
    if taxable <= REBATE_LIMIT:
        return 0.0
    tax = min(_slab_tax(taxable), taxable - REBATE_LIMIT)
    rate = next(r for top, r in SURCHARGE if taxable <= top)
    return round(tax * (1 + rate) * (1 + CESS))


@dataclass(frozen=True)
class TakeHome:
    monthly: int  # what reaches the bank account each month, from the fixed pay
    yearly_tax: int
    employee_pf: int  # a year: the employee's PF, kept for them, not spent
    employer_costs: int  # a year: employer PF and gratuity counted in the CTC
    professional_tax: int
    variable_after_tax: int  # the yearly variable pay, after the tax it adds
    assumptions: list[str]


def take_home(fixed: float, variable: float = 0, pf: PfMode = "capped",
              ctc_has_employer_costs: bool = True) -> TakeHome:
    """`fixed`: the fixed pay a year, as the offer states it. `ctc_has_employer_costs`: the CTC counts the employer's
    PF and gratuity (most Indian offers do)."""
    basic_month = fixed * BASIC_SHARE / 12
    pf_month = 0.0 if pf == "none" else PF_RATE * (min(basic_month, PF_WAGE_CAP) if pf == "capped" else basic_month)
    employer = (pf_month * 12 + GRATUITY_RATE * basic_month * 12) if ctc_has_employer_costs else 0.0
    gross = fixed - employer
    taxable = max(gross - STANDARD_DEDUCTION, 0)
    tax = income_tax(taxable)
    monthly = (gross - pf_month * 12 - PROFESSIONAL_TAX - tax) / 12
    variable_tax = income_tax(taxable + variable) - tax if variable else 0
    assumptions = [
        "New tax regime, FY 2026-27, with the ₹75,000 standard deduction",
        "Basic pay is half of the fixed pay",
        {"capped": "PF on ₹15,000 a month (₹1,800 each from you and the employer)",
         "full": "PF at 12% of the whole basic pay",
         "none": "No PF"}[pf],
        "The CTC includes the employer's PF and gratuity" if ctc_has_employer_costs
        else "The CTC doesn't include the employer's PF and gratuity",
        "Professional tax of ₹2,500 a year (it varies by state)",
    ]
    return TakeHome(monthly=round(monthly), yearly_tax=round(tax), employee_pf=round(pf_month * 12),
                    employer_costs=round(employer), professional_tax=PROFESSIONAL_TAX,
                    variable_after_tax=round(variable - variable_tax), assumptions=assumptions)
