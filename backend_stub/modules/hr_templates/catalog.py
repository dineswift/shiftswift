"""Platform HR template catalog — single source of truth for legal/version updates.

When UK law or guidance changes, update `version`, `change_summary`, and `content_markdown` here,
then run:  python scripts/sync_hr_templates.py
"""

from __future__ import annotations

from typing import Any

PLATFORM_PUBLISHER = "ShiftSwift HR · Datasoftware Analytics Ltd (Co. 14568900) · shiftswifthr.co.uk"

# Each entry: id, category, title, description, sort_order, version, legal_basis, change_summary, content_markdown
TEMPLATE_CATALOG: list[dict[str, Any]] = [
    {
        "id": "onboarding_checklist",
        "category": "onboarding",
        "title": "New starter onboarding checklist",
        "description": "Day-one to week-four tasks for UK hospitality new hires.",
        "sort_order": 10,
        "version": "1.0",
        "legal_basis": "HMRC PAYE starter procedures; UK Right to Work checks (Immigration Act 2016)",
        "change_summary": "Initial platform release.",
        "content_markdown": """# New starter onboarding checklist

## Before start date
- [ ] Offer letter and contract signed and filed
- [ ] Right to Work check completed and evidence stored (immutable PDF in ShiftSwift HR)
- [ ] HMRC starter checklist / P45 or new starter declaration
- [ ] Payroll details collected (bank, NI number, tax code)
- [ ] Uniform / equipment ordered
- [ ] Induction date and line manager confirmed
- [ ] If sponsored worker: SMS profile verified, CoS reference recorded, RTW share code checked if applicable

## Day one
- [ ] Photo ID and RTW re-verified if required
- [ ] Health & safety induction and fire evacuation
- [ ] GDPR / data protection briefing
- [ ] Issue employee handbook and key policies
- [ ] System access (email, rota, till/EPOS if applicable)
- [ ] Introduce to team and buddy/mentor

## First week
- [ ] Role-specific training plan started
- [ ] Allergen / food safety training (if hospitality)
- [ ] Probation objectives agreed in writing
- [ ] First welfare check-in with line manager

## First month
- [ ] Probation midpoint review scheduled
- [ ] Training records updated
- [ ] Any SMS-reportable changes (job title, salary, site) logged for sponsored workers

---
_Review with qualified HR counsel. Not legal advice._""",
    },
    {
        "id": "sponsor_worker_onboarding",
        "category": "onboarding",
        "title": "Sponsored worker onboarding (UK visa)",
        "description": "Home Office sponsor duties from offer to first month.",
        "sort_order": 20,
        "version": "1.1",
        "legal_basis": "Home Office sponsor guidance — worker attendance, SMS reporting, Right to Work",
        "change_summary": "v1.1 — Clarified excused absences (paid annual leave, authorised unpaid leave, bank holidays) vs unexcused days for the 10 working-day rule.",
        "content_markdown": """# Sponsored worker onboarding

## Pre-employment
1. Confirm Certificate of Sponsorship (CoS) details match the role offered
2. Complete Right to Work check using acceptable documents or eVisa share code
3. Store immutable RTW PDF with check date and outcome
4. Record visa type, expiry date, and work location on sponsor profile

## First 10 working days
- Monitor attendance daily on **working days** only (configure bank holidays in ShiftSwift HR)
- Record each absence with the correct type: paid annual leave, authorised unpaid leave, sick leave, and bank holidays are **excused** and do not count
- **Unauthorized** absences count toward the 10 consecutive working-day Home Office reporting threshold
- Day-9 alert must be acknowledged if triggered

## SMS reporting (within 10 days of change)
Report via Sponsorship Management System when any of these change:
- Job title
- Salary (must meet going rate for SOC code)
- Work location / site

## Ongoing
- RTW re-check before visa expiry
- Keep recruitment advert evidence for the role (RLMT where applicable)
- Document any disciplinary or grievance linked to absence patterns

---
_Sponsor licence duties remain with the employer. ShiftSwift HR provides alerts and records only._""",
    },
    {
        "id": "probation_review",
        "category": "probation",
        "title": "Probation review meeting template",
        "description": "Structured first probation review for line managers.",
        "sort_order": 30,
        "version": "1.0",
        "legal_basis": "ACAS code of practice; Employment Rights Act 1996 (unfair dismissal)",
        "change_summary": "Initial platform release.",
        "content_markdown": """# Probation review meeting

**Employee:**  
**Role:**  
**Line manager:**  
**Review date:**  
**Probation end date:**  

## Performance summary
| Objective | Rating (1–5) | Notes |
|-----------|--------------|-------|
|           |              |       |

## Strengths observed

## Areas for development

## Training completed during probation

## Attendance / punctuality

## Conduct and teamwork

## Decision
- [ ] Pass probation — confirm permanent employment
- [ ] Extend probation — new end date: ___________ (reason documented)
- [ ] Terminate — notice period and process per contract (seek HR advice)

## Employee comments

## Sign-off
Manager signature / date:  
Employee signature / date:  
HR copy filed: Yes / No

---
_Ensure fair process and ACAS guidance if dismissal is possible._""",
    },
    {
        "id": "annual_performance_review",
        "category": "probation",
        "title": "Annual performance review template",
        "description": "Structured annual appraisal for line managers — objectives, ratings, and development plan.",
        "sort_order": 35,
        "version": "1.0",
        "legal_basis": "ACAS guidance on performance management; Employment Rights Act 1996",
        "change_summary": "Initial platform release.",
        "content_markdown": """# Annual performance review

**Employee:**  
**Role:**  
**Department:**  
**Line manager:**  
**Review period:**  
**Review date:**  

## Objectives for the period
| Objective | Outcome (Met / Partly / Not met) | Notes |
|-----------|----------------------------------|-------|
|           |                                  |       |

## Performance summary (1–5 scale)
| Area | Rating | Evidence / examples |
|------|--------|---------------------|
| Quality of work | | |
| Reliability & attendance | | |
| Teamwork & communication | | |
| Customer service | | |
| Health & safety compliance | | |

## Strengths

## Development areas

## Training & CPD completed this year

## Goals for next period
| Goal | Target date | Support needed |
|------|-------------|----------------|
|      |             |                |

## Overall rating
- [ ] Exceeds expectations
- [ ] Meets expectations
- [ ] Needs improvement — PIP or support plan required

## Pay / promotion discussion (optional)
Notes (no obligation to award increase):

## Employee comments

## Sign-off
Manager signature / date:  
Employee signature / date:  
HR copy filed in Document store: Yes / No

---
_Store the signed form in the employee Document store. Use a separate disciplinary workflow if conduct issues arise._""",
    },
    {
        "id": "employee_handbook_outline",
        "category": "policy",
        "title": "Employee handbook outline",
        "description": "Sections to include in a UK hospitality employee handbook.",
        "sort_order": 40,
        "version": "1.0",
        "legal_basis": "Employment Rights Act 1996; Working Time Regulations 1998; Equality Act 2010",
        "change_summary": "Initial platform release.",
        "content_markdown": """# Employee handbook — suggested sections

1. **Welcome & company values**
2. **Terms of employment** — contracts, probation, notice periods
3. **Pay & benefits** — pay dates, overtime, tronc/tips policy if applicable
4. **Working time** — hours, breaks, rest days, flexible working requests
5. **Leave** — annual leave booking, sick leave, maternity/paternity, unpaid leave
6. **Standards of conduct** — dress code, mobile phone, social media
7. **Health & safety** — accidents, first aid, lone working
8. **Equality, diversity & harassment** — zero tolerance, reporting routes
9. **Disciplinary & grievance** — summary of process and ACAS alignment
10. **Data protection** — employee personal data use
11. **Sponsor workers** — if applicable: attendance, SMS reporting, RTW
12. **Whistleblowing**

Customise for your sites and seek legal review before publication.""",
    },
    {
        "id": "rtw_weekly_hr_check",
        "category": "compliance",
        "title": "Weekly HR compliance check (RTW & sponsor)",
        "description": "Short weekly checklist for HR administrators.",
        "sort_order": 50,
        "version": "1.0",
        "legal_basis": "UK Right to Work checks; Home Office sponsor licence duties",
        "change_summary": "Initial platform release.",
        "content_markdown": """# Weekly HR compliance check

## Right to Work
- [ ] Review RTW checks expiring in next 30 days
- [ ] Chase managers for missing RTW PDF evidence
- [ ] Re-check share codes where time-limited permission applies

## Sponsored workers
- [ ] Review unexcused absence streaks (day 7+ warnings)
- [ ] Acknowledge any day-9 absence alerts
- [ ] Clear open SMS change reports (job title / salary / location)
- [ ] Update bank holiday calendar if sites closed

## Records
- [ ] Grievance cases — ACAS deadlines on track
- [ ] Open offboarding / cessation reporting tasks
- [ ] Advert records complete for recent sponsored hires

**Completed by:** __________ **Date:** __________""",
    },
    {
        "id": "leaver_offboarding",
        "category": "offboarding",
        "title": "Leaver offboarding checklist",
        "description": "Resignation, dismissal, and redundancy leaver process.",
        "sort_order": 60,
        "version": "1.0",
        "legal_basis": "Employment Rights Act 1996; Home Office sponsor cessation reporting",
        "change_summary": "Initial platform release.",
        "content_markdown": """# Leaver offboarding checklist

## HR administration
- [ ] Resignation letter or termination letter on file
- [ ] Final pay and holiday accrual calculated
- [ ] P45 issued via payroll
- [ ] Return uniform, keys, ID badge, equipment
- [ ] Revoke system access (email, rota, EPOS)
- [ ] Exit interview completed (optional)

## Sponsored worker (if applicable)
- [ ] Mark sponsorship cessation in SMS within required timeframe
- [ ] Record Home Office report reference in ShiftSwift HR
- [ ] Notify compliance team of last working day

## Knowledge transfer
- [ ] Handover notes from line manager
- [ ] Update rota and cover arranged

**Leaver name:** __________ **Last day:** __________ **Reason:** __________""",
    },
    {
        "id": "grievance_investigation",
        "category": "disciplinary",
        "title": "Grievance investigation plan",
        "description": "Initial investigation steps after a formal grievance is raised.",
        "sort_order": 70,
        "version": "1.0",
        "legal_basis": "ACAS code of practice on disciplinary and grievance procedures",
        "change_summary": "Initial platform release.",
        "content_markdown": """# Grievance investigation plan

**Case reference:**  
**Complainant:**  
**Investigator:**  
**Date opened:**  
**ACAS early conciliation deadline (if applicable):**  

## Allegation summary

## Witnesses to interview
1.
2.

## Documents to review
-

## Timeline
| Date | Action | Owner |
|------|--------|-------|
|      |        |       |

## Interim measures (if any)
- Suspension? (document separately — not a punishment)
- Temporary reporting line change?

## Outcome options
- Uphold / partially uphold / not upheld
- Remedial action
- Appeal rights communicated

Store investigation notes securely (encrypted in ShiftSwift HR grievance module).""",
    },
    {
        "id": "interview_tandoori_chef",
        "category": "recruitment",
        "title": "Interview guide — Tandoori chef",
        "description": "Structured interview for tandoor, grill, and clay-oven chefs in UK Indian restaurants.",
        "sort_order": 80,
        "version": "1.0",
        "legal_basis": "Equality Act 2010 (fair recruitment); Food Safety Act 1990; UK Right to Work (Immigration Act 2016)",
        "change_summary": "Initial release — UK restaurant tandoor chef interview pack.",
        "content_markdown": """# Interview guide — Tandoori chef

**Site / restaurant:**  
**Interviewer(s):**  
**Date:**  
**Candidate name:**  
**Contact:**  

## Role summary
Responsible for tandoor station: naan, kebabs, tandoori mains, grill items, marinade prep, and safe operation of high-heat equipment.

## Pre-interview checks
- [ ] Right to Work verified (or conditional offer subject to RTW before start)
- [ ] Same core questions asked of all candidates (consistent scoring)
- [ ] Reasonable adjustments offered and recorded if requested

## Experience & technical skills
| Area | Question / prompt | Score 1–5 | Notes |
|------|-------------------|-----------|-------|
| Tandoor operation | Describe your experience with clay tandoor / charcoal grill. Temperature control? | | |
| Bread & dough | How do you prepare and cook naan, roti, or kulcha to order? | | |
| Marinades | Walk us through your chicken/lamb tikka or seekh kebab marinade process. | | |
| Protein prep | How do you trim, portion, and thread kebabs for even cooking? | | |
| Speed & timing | How do you manage multiple orders during a busy Friday/Saturday service? | | |
| Menu knowledge | Which tandoor dishes have you cooked regularly? Any regional specialities? | | |
| Quality control | How do you check doneness without drying proteins? | | |
| Equipment care | How do you clean and maintain tandoor / grill safely at end of shift? | | |

## Food safety & compliance
- Level 2 Food Hygiene certificate held? Expiry date: __________
- Allergen awareness — how do you prevent cross-contact (gluten, nuts, dairy)?
- Describe colour-coding / separate utensils for raw and cooked.
- What would you do if you suspected undercooked chicken leaving the pass?

## Team & working conditions
- Experience working with head chef / curry section during service?
- Comfortable with heat, long shifts, and split shifts?
- How do you communicate delays to the pass or front of house?
- Example of handling constructive criticism during a busy service.

## Practical assessment (if used)
- [ ] Live cook test arranged — date: __________
- [ ] Dishes tested: __________
- [ ] Hygiene observed during test: Pass / Fail / N/A

## Scoring summary
| Criteria | Weight | Score /5 | Weighted |
|----------|--------|----------|----------|
| Tandoor technique | 30% | | |
| Food safety | 25% | | |
| Speed & organisation | 20% | | |
| Team fit | 15% | | |
| Communication | 10% | | |
| **Total** | 100% | | |

**Recommendation:** Hire / Second interview / Hold / Reject  
**Proposed start date:** __________ **Salary / rate agreed:** __________

## References
- Ref 1: __________ Verified: Y / N
- Ref 2: __________ Verified: Y / N

## Sign-off
Interviewer signature / date:  
HR file reference:  

---
_Equal opportunities — score on ability only. Keep notes factual. Not legal advice._""",
    },
    {
        "id": "interview_sous_chef",
        "category": "recruitment",
        "title": "Interview guide — Sous chef",
        "description": "Second-in-command kitchen interview for brigade leadership in UK restaurants.",
        "sort_order": 90,
        "version": "1.0",
        "legal_basis": "Equality Act 2010 (fair recruitment); Food Safety Act 1990; Health and Safety at Work Act 1974",
        "change_summary": "Initial release — sous chef leadership and kitchen management interview pack.",
        "content_markdown": """# Interview guide — Sous chef

**Site / restaurant:**  
**Interviewer(s):**  
**Date:**  
**Candidate name:**  
**Contact:**  

## Role summary
Deputy to head chef: runs kitchen in their absence, supervises sections (tandoor, curry, starter, prep), stock control, training, and service standards.

## Pre-interview checks
- [ ] Right to Work verified (or conditional offer subject to RTW before start)
- [ ] Same core questions asked of all candidates
- [ ] Reasonable adjustments offered and recorded if requested

## Leadership & kitchen management
| Area | Question / prompt | Score 1–5 | Notes |
|------|-------------------|-----------|-------|
| Brigade experience | Describe running a kitchen section during peak service. | | |
| Head chef cover | How would you brief the team if the head chef is absent? | | |
| Delegation | How do you assign tasks across tandoor, curry, and prep? | | |
| Training | How do you onboard a new commis or trainee chef? | | |
| Conflict | Example of resolving a disagreement between line chefs under pressure. | | |
| Standards | How do you enforce plating, portion control, and wastage targets? | | |

## Technical breadth (Indian restaurant)
- Comfortable supervising both tandoor and curry sections?
- Experience with batch prep, mise en place, and sauce bases?
- Menu costing / GP awareness?
- HACCP monitoring and fridge/freezer temp logs — your routine?

## Food safety & compliance
- Food Hygiene Level 3 or equivalent? Certificate date: __________
- How do you manage allergen information to the pass and waiting staff?
- Procedure when equipment fails mid-service (oven, fryer, refrigeration)?
- Accident / burn reporting — what is your immediate response?

## Stock, cost & admin
- Stock ordering and supplier relationships experience?
- How do you reduce wastage on proteins, veg, and dry goods?
- Rota awareness and labour cost control?

## Practical assessment (optional)
- [ ] Kitchen trial shift — date: __________
- [ ] Service observation: Pass / Fail / N/A

## Scoring summary
| Criteria | Weight | Score /5 | Weighted |
|----------|--------|----------|----------|
| Leadership | 30% | | |
| Technical kitchen skills | 25% | | |
| Food safety & HACCP | 20% | | |
| Cost / stock control | 15% | | |
| Communication | 10% | | |
| **Total** | 100% | | |

**Recommendation:** Hire / Second interview / Hold / Reject  
**Proposed start date:** __________ **Salary:** __________

## References
- Ref 1: __________ Verified: Y / N
- Ref 2: __________ Verified: Y / N

## Sign-off
Interviewer signature / date:  

---
_Sous chef is a safety-critical role — verify references and trial shift where possible._""",
    },
    {
        "id": "interview_curry_chef",
        "category": "recruitment",
        "title": "Interview guide — Indian curry chef",
        "description": "Interview pack for curry section chefs: sauces, tarka, balti, and main-course production.",
        "sort_order": 100,
        "version": "1.0",
        "legal_basis": "Equality Act 2010 (fair recruitment); Food Safety Act 1990; Natasha's Law (allergen labelling awareness)",
        "change_summary": "Initial release — Indian curry section chef interview pack.",
        "content_markdown": """# Interview guide — Indian curry chef

**Site / restaurant:**  
**Interviewer(s):**  
**Date:**  
**Candidate name:**  
**Contact:**  

## Role summary
Owns curry section: base gravies, tarka, spice blending, main courses (korma, madras, vindaloo, balti, etc.), vegetarian/vegan options, and consistency at volume.

## Pre-interview checks
- [ ] Right to Work verified (or conditional offer subject to RTW before start)
- [ ] Consistent questions and scoring for all candidates
- [ ] Reasonable adjustments recorded if applicable

## Technical skills — curry section
| Area | Question / prompt | Score 1–5 | Notes |
|------|-------------------|-----------|-------|
| Base gravies | Explain how you prepare onion-tomato base or restaurant-style curry sauce. | | |
| Spice knowledge | Difference in approach for korma, madras, vindaloo, and jalfrezi? | | |
| Tarka / tempering | Demonstrate knowledge of finishing oils and whole spices. | | |
| Protein / veg | Cooking times for chicken, lamb, paneer, and mixed veg curries. | | |
| Consistency | How do you replicate the same heat and flavour on busy nights? | | |
| Batch vs à la carte | Experience with lunch buffets vs evening à la carte? | | |
| Dietary | Handling nut-free, dairy-free, gluten-aware, and vegan requests. | | |
| Wastage | Portion sizes and holding times — your standards? | | |

## Food safety & allergens
- Level 2 Food Hygiene — valid? Expiry: __________
- How do you prevent cross-contact for nut allergies?
- Separate utensils and fryers for vegetarian / vegan where required?
- What allergen info do you give the pass for each dish?

## Service & teamwork
- Coordination with tandoor section on combined orders?
- How do you prioritise tickets when the kitchen is full?
- Accept feedback from head chef on spice levels or consistency?

## Practical cook test (recommended)
| Dish requested | Heat level | Presentation | Hygiene | Score /5 |
|----------------|------------|--------------|---------|----------|
| Chef's choice curry | | | | |
| Vegetarian main | | | | |
| Base gravy sample | | | | |

## Scoring summary
| Criteria | Weight | Score /5 | Weighted |
|----------|--------|----------|----------|
| Curry technique & spice balance | 35% | | |
| Food safety & allergens | 25% | | |
| Consistency & speed | 20% | | |
| Teamwork | 10% | | |
| Communication | 10% | | |
| **Total** | 100% | | |

**Recommendation:** Hire / Second interview / Hold / Reject  
**Section:** Curry / Combined / Other: __________

## References
- Ref 1: __________ Verified: Y / N

## Sign-off
Interviewer signature / date:  

---
_Trial cook test should use the restaurant's own recipes and allergen matrix._""",
    },
    {
        "id": "interview_restaurant_manager",
        "category": "recruitment",
        "title": "Interview guide — Restaurant manager",
        "description": "General manager / restaurant manager interview for UK hospitality sites.",
        "sort_order": 110,
        "version": "1.0",
        "legal_basis": "Equality Act 2010; Licensing Act 2003 (if alcohol); UK GDPR; Working Time Regulations 1998",
        "change_summary": "Initial release — restaurant manager interview pack (operations, people, compliance).",
        "content_markdown": """# Interview guide — Restaurant manager

**Site / restaurant:**  
**Interviewer(s):**  
**Date:**  
**Candidate name:**  
**Contact:**  

## Role summary
Day-to-day running of the restaurant: service standards, staff rota, customer experience, compliance, sales, and liaison with head chef / area manager.

## Pre-interview checks
- [ ] Right to Work verified
- [ ] Personal Licence holder if site sells alcohol? (Yes / No / N/A) Licence no: __________
- [ ] Structured scoring used for all manager candidates

## Operations & commercial
| Area | Question / prompt | Score 1–5 | Notes |
|------|-------------------|-----------|-------|
| P&L awareness | How have you controlled labour and food cost percentages? | | |
| Sales & upselling | Tactics for increasing average spend without pressure selling. | | |
| Busy service | Describe managing a full restaurant with staff absence. | | |
| Customer complaints | Example of turning a complaint into a return visit. | | |
| Health visit | Experience with EHO visits and hygiene rating improvement. | | |
| Cash / EPOS | Till reconciliation, voids, and fraud prevention. | | |
| Opening / closing | Your checklist for open and close of site. | | |

## People management
- Rota planning around peaks, holidays, and statutory rest breaks?
- How do you conduct return-to-work and absence conversations fairly?
- Disciplinary awareness — when would you escalate to HR?
- Training waiters and floor staff on allergens and upselling?
- Staff retention — what has worked in your previous sites?

## Compliance (UK restaurant)
- Allergen matrix kept up to date — your process?
- Fire evacuation and emergency procedures ownership?
- GDPR — handling customer bookings and staff records?
- Sponsor licence sites: awareness of RTW and attendance reporting? (Y / N / N/A)

## Scenario questions
1. Two tables complain about long waits during a Saturday peak — your steps?
2. Chef refuses a reasonable customer allergy request — what do you do?
3. Suspected intoxicated customer — licensing and safety approach?

## Scoring summary
| Criteria | Weight | Score /5 | Weighted |
|----------|--------|----------|----------|
| Operations & commercial | 30% | | |
| People leadership | 25% | | |
| Compliance & safety | 25% | | |
| Customer focus | 15% | | |
| Communication | 5% | | |
| **Total** | 100% | | |

**Recommendation:** Hire / Second interview / Hold / Reject  
**Salary / package:** __________ **Notice period:** __________

## References
- Ref 1 (previous employer): __________ Verified: Y / N
- Ref 2: __________ Verified: Y / N

## Sign-off
Interviewer signature / date:  

---
_Manager appointments should include probation objectives and clear authority limits._""",
    },
    {
        "id": "interview_waiter",
        "category": "recruitment",
        "title": "Interview guide — Waiter / front of house",
        "description": "Server interview for UK restaurants — service, allergens, and customer care.",
        "sort_order": 120,
        "version": "1.0",
        "legal_basis": "Equality Act 2010 (fair recruitment); Food Safety Act 1990; Natasha's Law (allergen communication)",
        "change_summary": "Initial release — waiter and front-of-house interview pack.",
        "content_markdown": """# Interview guide — Waiter / front of house

**Site / restaurant:**  
**Interviewer(s):**  
**Date:**  
**Candidate name:**  
**Contact:**  

## Role summary
Table service, order taking, allergen communication, payment handling, and maintaining dining room standards.

## Pre-interview checks
- [ ] Right to Work verified (or conditional offer subject to RTW before start)
- [ ] Same questions for all candidates; adjustments noted
- [ ] Availability matches rota needs (days / evenings / weekends): __________

## Customer service & experience
| Area | Question / prompt | Score 1–5 | Notes |
|------|-------------------|-----------|-------|
| Experience | Previous waiting or hospitality roles? | | |
| First impression | How do you greet and seat guests? | | |
| Upselling | Suggest starters, sides, or drinks without being pushy. | | |
| Difficult guests | Example of calm handling of an unhappy customer. | | |
| Teamwork | Supporting colleagues when the floor is busy. | | |
| Pace | Experience on busy Friday/Saturday services? | | |
| Appearance | Understanding of uniform and hygiene standards. | | |

## Allergens & food safety (critical)
- How do you take an allergen order and confirm with the kitchen?
- What would you do if a guest says they have a **severe nut allergy**?
- Never guess ingredients — describe your process.
- Basic food hygiene certificate? (Desirable) Y / N

## Practical scenarios
1. Guest asks if a curry contains dairy — you are not 100% sure. Your steps?
2. Table of eight wants split bills and mixed payment — approach?
3. You notice a spill near the kitchen pass — action?

## Skills checklist
- [ ] Comfortable carrying plates / trays
- [ ] Basic EPOS or handheld ordering (trainable)
- [ ] English communication sufficient for menu and allergens
- [ ] Additional languages (asset): __________

## Scoring summary
| Criteria | Weight | Score /5 | Weighted |
|----------|--------|----------|----------|
| Customer service | 35% | | |
| Allergen awareness | 30% | | |
| Reliability & availability | 20% | | |
| Team fit | 10% | | |
| Presentation | 5% | | |
| **Total** | 100% | | |

**Recommendation:** Hire / Trial shift / Hold / Reject  
**Trial shift date:** __________ **Hourly rate:** __________

## References
- Ref 1: __________ Verified: Y / N

## Sign-off
Interviewer signature / date:  

---
_Allergen failure is a serious risk — do not hire without satisfactory allergen answers or trial._""",
    },
    {
        "id": "contract_full_time",
        "category": "contracts",
        "title": "Employment contract — Full-time",
        "description": "UK full-time contract of employment for restaurant and hospitality staff (chefs, FOH, managers).",
        "sort_order": 130,
        "version": "1.1",
        "legal_basis": "Employment Rights Act 1996 (written particulars); Working Time Regulations 1998; National Minimum Wage Act 1998; Equality Act 2010",
        "change_summary": "ACAS written-statement structure aligned; hospitality schedule retained.",
        "source": "acas",
        "source_url": "https://www.acas.org.uk/templates/written-statement-templates",
        "source_label": "ACAS written statement of employment particulars",
        "content_markdown": """# Contract of employment — Full-time

**This document is a template only.** Have it reviewed by qualified UK employment solicitors before use. ShiftSwift HR does not provide legal advice.

---

## 1. Parties

**Employer:**  
**Trading name:**  
**Registered address:**  
**Company number (if applicable):**  

**Employee:**  
**Address:**  
**NI number:**  

**Contract date:** __________  
**Start date:** __________  
**Continuous employment date (if different):** __________  

---

## 2. Job title and duties

**Job title:** __________ (e.g. Tandoori chef / Sous chef / Curry chef / Waiter / Restaurant manager)

**Reporting to:** __________

**Main duties include:**
- Carry out duties reasonably assigned for your role in a UK restaurant / hospitality business
- Comply with food safety, allergen, health & safety, and licensing standards
- Follow reasonable instructions, rotas, and uniform / appearance standards
- Treat colleagues and customers with respect; comply with equality and harassment policies
- Other duties: __________

The employer may assign reasonable alternative duties consistent with your skills and grade.

---

## 3. Place of work

**Primary site:** __________  
**Other sites:** The employer may require you to work at other group sites within reasonable travel distance, with notice where practicable.

**Hybrid / remote:** Not applicable unless agreed in writing.

---

## 4. Hours of work — full-time

**Normal working hours:** __________ hours per week (e.g. 40–48 hours).

**Pattern:** Shift rota including evenings, weekends, and bank holidays as required by the business. Rota issued in advance: __________ days.

**Rest breaks:** As required by the Working Time Regulations 1998 (minimum 20 minutes when working more than 6 hours, unless agreed otherwise in a valid workforce agreement).

**Daily rest:** Minimum 11 consecutive hours between shifts where reasonably practicable.

**Weekly rest:** Minimum 24 hours in each 7-day period (or 48 hours in each 14-day period if agreed).

**Overtime:** Additional hours may be required during peak trading. Overtime paid / time off in lieu: __________ (must meet or exceed National Minimum Wage / National Living Wage).

**Opt-out (48-hour week):**  
- [ ] Employee has signed a separate 48-hour opt-out agreement  
- [ ] No opt-out — working time limited to 48 hours per week averaged over 17 weeks  

---

## 5. Remuneration

**Basic salary / hourly rate:** £__________ per __________ (hour / annum)

**Pay frequency:** __________ (e.g. monthly / four-weekly), on or about __________

**Pay method:** BACS to nominated bank account

**Deductions:** Statutory and contractual deductions (tax, NI, pension, attachment of earnings, etc.)

**Tips / tronc / service charge (if applicable):**  
Policy reference: __________. Tips do not count toward National Minimum Wage unless permitted by law.

**Review:** Salary reviewed __________; no obligation to award an increase.

---

## 6. Holiday entitlement

**Statutory minimum plus contract:** __________ days per holiday year (inclusive of 5.6 weeks statutory for full-time), pro-rated in first/last year.

**Holiday year runs:** __________ to __________

**Booking:** Requests subject to business needs; notice required: __________ weeks.

**Carry over:** __________ (statutory minimum rules apply).

**On termination:** Accrued untaken holiday paid / deducted in final pay.

---

## 7. Sickness absence

**Reporting:** Notify __________ by __________ on first day of absence; provide expected return date.

**Fit notes:** Required from day __________ of absence (or earlier if requested).

**Statutory Sick Pay (SSP):** Paid if eligible under statutory rules.

**Company sick pay (if any):** __________

---

## 8. Pension

The employer will auto-en enrol eligible jobholders into a qualifying pension scheme in line with Pensions Act 2008. Details provided separately.

**Employee contribution:** __________% **Employer contribution:** __________%

---

## 9. Probationary period

**Length:** __________ months from start date.

**Notice during probation:** Employer __________ ; Employee __________ (minimum statutory notice applies once 1 month’s service completed).

**Extension:** Possible by up to __________ months with written reasons.

**Standards:** Attendance, conduct, and performance assessed. Failure may result in termination following fair process.

---

## 10. Other paid leave

- Maternity / paternity / adoption / shared parental — statutory entitlements apply  
- Parental bereavement — statutory where eligible  
- Compassionate leave — __________ days at employer discretion  
- Jury service / public duties — as required by law  

---

## 11. Confidentiality and data protection

Employee must not disclose confidential information (recipes, supplier terms, customer data, staff records, financial information) during or after employment except as required by law.

Personal data processed per UK GDPR and the employer privacy notice for employees.

---

## 12. Health and safety

Employee must follow H&S policies, report hazards, wear PPE where required, and complete mandatory training (including food hygiene and allergen awareness where relevant).

---

## 13. Equipment and uniform

**Uniform / PPE supplied:** __________  
**Return on leaving:** Yes — failure to return may result in reasonable deduction if agreed in writing.

**Personal property:** Employer not liable for unattended personal items unless negligence applies.

---

## 14. Disciplinary and grievance

Disciplinary and grievance procedures are in the employee handbook / separate policy (ACAS-aligned). Summary provided on request.

**Serious misconduct** (non-exhaustive): theft, violence, serious breach of food safety or allergen procedures, being under the influence at work, gross insubordination — may result in summary dismissal following fair investigation.

---

## 15. Notice of termination

**After successful probation:**  
- **Employee:** __________ weeks’ notice  
- **Employer:** __________ weeks’ notice (or statutory minimum if greater)

**Payment in lieu:** Employer may pay in lieu of notice at its discretion unless contract states otherwise.

**Garden leave:** Employer may require employee not to attend work during notice while salary continues.

---

## 16. Restrictions after leaving (optional — legal review required)

**Non-compete / non-solicitation:** __________ (blank if none — overly broad clauses may be unenforceable)

---

## 17. Changes to terms

Employer may make reasonable changes for business reasons after consultation. Material changes confirmed in writing within one month.

---

## 18. Collective agreements

**Applicable collective agreement:** None / __________

---

## 19. Governing law

This contract is governed by the laws of **England and Wales** / **Scotland** (delete as applicable). Courts of __________ have jurisdiction.

---

## 20. Entire agreement

This contract, the employee handbook, and policies referenced herein form the agreement. Previous representations not in writing are excluded except for fraud.

---

## Signatures

**For and on behalf of the employer:**

Name: __________  
Title: __________  
Signature: __________ Date: __________  

**Employee:**

I confirm I have read and understood this contract and the staff handbook.

Signature: __________ Date: __________  

---

## Schedule A — Written particulars checklist (ERA 1996)

- [ ] Names of employer and employee  
- [ ] Start date and continuous employment  
- [ ] Pay scale / rate and interval  
- [ ] Hours and days of work  
- [ ] Holiday entitlement  
- [ ] Sick pay terms  
- [ ] Pension scheme access  
- [ ] Notice periods  
- [ ] Job title / description  
- [ ] Place of work  
- [ ] Disciplinary and grievance rules  
- [ ] Training entitlements (if mandatory)  

---
_Review with qualified employment law counsel before issue. Keep signed copy in ShiftSwift HR document store._""",
    },
    {
        "id": "contract_part_time",
        "category": "contracts",
        "title": "Employment contract — Part-time",
        "description": "UK part-time contract for restaurant staff with pro-rata terms and PTWR compliance.",
        "sort_order": 140,
        "version": "1.1",
        "legal_basis": "Employment Rights Act 1996; Part-time Workers (Prevention of Less Favourable Treatment) Regulations 2000; Working Time Regulations 1998",
        "change_summary": "ACAS written-statement structure aligned; part-time schedule retained.",
        "source": "acas",
        "source_url": "https://www.acas.org.uk/templates/written-statement-templates",
        "source_label": "ACAS written statement of employment particulars",
        "content_markdown": """# Contract of employment — Part-time

**This document is a template only.** Have it reviewed by qualified UK employment solicitors before use. ShiftSwift HR does not provide legal advice.

---

## 1. Parties

**Employer:**  
**Trading name:**  
**Registered address:**  

**Employee:**  
**Address:**  
**NI number:**  

**Contract date:** __________  
**Start date:** __________  

---

## 2. Part-time status

The employee is engaged on a **part-time** basis. Part-time workers must not be treated less favourably than comparable full-time workers unless objectively justified (Part-time Workers Regulations 2000).

**Comparable full-time role (if any):** __________

---

## 3. Job title and duties

**Job title:** __________ (e.g. Waiter / Commis chef / Kitchen porter / Host)

**Reporting to:** __________

Duties as for the full-time role, pro-rated to hours worked. See full-time job description reference: __________ (if attached).

---

## 4. Place of work

**Primary site:** __________  
**Other sites:** As reasonably required with notice.

---

## 5. Hours of work — part-time

**Contracted hours:** __________ hours per week (guaranteed minimum).

**Typical pattern:** __________ (e.g. Fri–Sun evenings; Tue–Thu lunch; variable rota).

**Rota notice:** Issued __________ days in advance.

**Additional shifts:** Employer may offer extra shifts; employee __________ (may accept / decline without detriment where not contracted).

**Maximum hours (optional cap):** __________ hours per week unless overtime agreed.

**Rest breaks & working time:** Working Time Regulations 1998 apply. Daily and weekly rest periods observed where practicable.

**48-hour limit:** Unless a separate opt-out is signed, average working time must not exceed 48 hours per week over 17 weeks.

---

## 6. Remuneration

**Hourly rate:** £__________ per hour (must meet National Minimum Wage / National Living Wage for age band).

**Pay frequency:** __________  
**Pay method:** BACS  

**Pro-rata principle:** Benefits listed below apply pro-rata unless stated otherwise.

**Tips / tronc:** Per employer tronc policy __________ — does not substitute minimum wage unless lawfully structured.

---

## 7. Holiday entitlement — pro-rata

**Annual entitlement:** __________ days (including statutory holiday, pro-rated to contracted hours vs full-time equivalent of __________ days).

**Calculation example:**  
Full-time equivalent: 28 days for 40 hours/week → part-time __________ hours = __________ days.

**Holiday year:** __________ to __________

**Booking:** Subject to rota cover; minimum notice __________ weeks.

**On termination:** Accrued holiday paid in final pay.

---

## 8. Sickness absence

Notify __________ by __________ on day one. Fit note rules same as full-time staff.

**SSP:** If eligible under statutory rules.

**Company sick pay (if offered to PT staff):** __________ (must not less favourably treat PT vs FT unless justified).

---

## 9. Pension

Auto-enrolment applies if earnings and age meet eligibility. Employer and employee contribution rates: __________

---

## 10. Probation

**Length:** __________ months.

**Notice in probation:** Employer __________ ; Employee __________

---

## 11. Benefits — pro-rata and parity

| Benefit | Full-time entitlement | Part-time entitlement |
|---------|----------------------|------------------------|
| Staff meals on shift | Yes | Yes |
| Uniform | Provided | Provided |
| Training (food hygiene etc.) | Mandatory | Mandatory |
| Company sick pay | __________ | __________ pro-rata / same |
| Enhanced holiday | __________ | Pro-rata |
| Bonus / tronc | Per policy | Per policy — no exclusion solely due to part-time status |

**Less favourable treatment:** Only permitted if objectively justified and documented.

---

## 12. Confidentiality, H&S, uniform

Same obligations as full-time colleagues: confidentiality, allergen and food safety compliance, uniform return on exit.

---

## 13. Disciplinary and grievance

Employee handbook / ACAS-aligned procedures apply equally to part-time staff.

---

## 14. Notice of termination

**After probation:**  
- **Employee:** __________ weeks  
- **Employer:** __________ weeks (statutory minimum if greater)

Part-time status does not reduce statutory notice once qualifying service is reached.

---

## 15. Variation of hours

Employer may request reasonable change to shift pattern after consultation. Material reduction in guaranteed hours requires written agreement or contractual change process.

**Right to request flexible working:** Employee with 26 weeks’ service may submit a statutory flexible working request (including change to hours).

---

## 16. Fixed-term (if applicable)

**End date:** __________ / **Not fixed-term**

If fixed-term: early termination clauses __________ ; redundancy rights if continuously employed 2+ years.

---

## 17. Governing law

England and Wales / Scotland — __________

---

## Signatures

**Employer:**  
Name / title: __________ Signature: __________ Date: __________  

**Employee:**  
I confirm this is a part-time contract and I have received the written particulars below.

Signature: __________ Date: __________  

---

## Schedule — Key particulars at a glance

| Item | Detail |
|------|--------|
| Contract type | Part-time |
| Guaranteed hours | __________ / week |
| Hourly rate | £__________ |
| Holiday (pro-rata) | __________ days |
| Probation | __________ months |
| Notice (after probation) | __________ weeks |
| Pension | Auto-enrolment — scheme __________ |

---
_Ensure hourly rate and holiday pro-rata calculations are checked each April (NMW/NLW updates). Solicitor review required before use._""",
    },
    {
        "id": "contract_zero_hours",
        "category": "contracts",
        "title": "Employment contract — Zero-hours / casual",
        "description": "Zero-hours or casual hospitality contract — no guaranteed hours, NMW/NLW and Working Time protections.",
        "sort_order": 135,
        "version": "1.0",
        "legal_basis": "Employment Rights Act 1996; National Minimum Wage Act 1998; Working Time Regulations 1998",
        "change_summary": "Initial release — zero-hours hospitality contract with ACAS-aligned particulars structure.",
        "source": "acas",
        "source_url": "https://www.acas.org.uk/templates/written-statement-templates",
        "source_label": "ACAS written statement of employment particulars",
        "content_markdown": """# Contract of employment — Zero-hours / casual

**This document is a template only.** Have it reviewed by qualified UK employment solicitors before use. ShiftSwift HR does not provide legal advice.

---

## 1. Parties

**Employer:** __________  
**Employee:** __________  
**Start date:** __________  

---

## 2. Zero-hours status

The employee is engaged on a **zero-hours** basis. There is **no guarantee** of minimum hours each week. Hours will be offered as business needs require and the employee may accept or decline shifts offered in line with your rota process.

**Typical shift pattern (if any):** __________  

---

## 3. Job title and duties

**Job title:** __________  
**Main duties:** __________  

---

## 4. Place of work

**Primary site:** __________  
**Other locations:** As reasonably required  

---

## 5. Pay

**Hourly rate:** £__________ (must meet National Minimum Wage / National Living Wage for age band)  
**Pay interval:** Weekly / fortnightly / monthly (BACS)  
**Overtime:** __________  

---

## 6. Hours and Working Time Regulations

- Maximum weekly working time limits apply (including averaging where agreed).  
- Rest breaks and rest periods as per Working Time Regulations 1998.  
- **Opt-out of 48-hour week (if applicable):** __________  

---

## 7. Holiday

**Annual leave (pro-rata to hours worked):** __________ days  
**Holiday year:** __________  

---

## 8. Notice periods

**Employee notice:** __________  
**Employer notice:** __________ (statutory minimum applies)  

---

## 9. Disciplinary and grievance

ACAS-aligned procedures — see staff handbook / separate policies.

---

## 10. Confidentiality

Employee must not disclose confidential business information during or after employment except as required by law.

---

**Employee signature:** __________ **Date:** __________  
**Employer signature:** __________ **Date:** __________  

---
_Check hourly rate each April when NMW/NLW rates change. Solicitor review required before issue._""",
    },
    {
        "id": "contract_fixed_term",
        "category": "contracts",
        "title": "Employment contract — Fixed-term / seasonal",
        "description": "Fixed-term contract for seasonal, event, or visa-limited hospitality roles with end date.",
        "sort_order": 145,
        "version": "1.0",
        "legal_basis": "Employment Rights Act 1996; Fixed-term Employees (Prevention of Less Favourable Treatment) Regulations 2002",
        "change_summary": "Initial release — fixed-term hospitality contract with end date and renewal clause.",
        "source": "acas",
        "source_url": "https://www.acas.org.uk/templates/written-statement-templates",
        "source_label": "ACAS written statement templates",
        "content_markdown": """# Contract of employment — Fixed-term / seasonal

**This document is a template only.** Have it reviewed by qualified UK employment solicitors before use. ShiftSwift HR does not provide legal advice.

---

## 1. Parties and term

**Employer:** __________  
**Employee:** __________  
**Start date:** __________  
**End date (fixed term):** __________  
**Reason for fixed term:** Seasonal demand / cover / project / other: __________  

Employment ends automatically on the end date unless renewed in writing. Fixed-term employees must not be treated less favourably than comparable permanent staff unless objectively justified.

---

## 2. Job title and duties

**Job title:** __________  
**Duties:** __________  

---

## 3. Place of work

**Location(s):** __________  

---

## 4. Hours and pay

**Hours per week (expected):** __________  
**Salary / hourly rate:** £__________ per __________  
**Pay interval:** __________  

---

## 5. Holiday and sick pay

**Annual leave:** __________ days (pro-rata if applicable)  
**Sick pay:** Statutory Sick Pay and any company sick pay: __________  

---

## 6. Notice

**During fixed term:** __________  
**On expiry:** Employment ends on end date unless extended by written agreement.  

---

## 7. Renewal / extension

Any extension must be agreed in writing before the end date. If employment continues after end date without new agreement, seek legal advice on permanent status.

---

## 8. Disciplinary and grievance

ACAS-aligned procedures apply.

---

**Employee signature:** __________ **Date:** __________  
**Employer signature:** __________ **Date:** __________  

---
_Review fixed-term fairness and renewal rules with employment solicitors. For sponsored workers, align end date with visa permission._""",
    },
    {
        "id": "written_statement_acas",
        "category": "contracts",
        "title": "Written statement of employment particulars",
        "description": "Statutory written particulars (ERA 1996 s.1) — ACAS structure for UK employers.",
        "sort_order": 120,
        "version": "1.0",
        "legal_basis": "Employment Rights Act 1996 s.1–4; ACAS written statement templates",
        "change_summary": "Initial release — ACAS-aligned written statement for hospitality employers.",
        "source": "acas",
        "source_url": "https://www.acas.org.uk/templates/written-statement-templates",
        "source_label": "ACAS written statement templates",
        "content_markdown": """# Written statement of employment particulars

**Template aligned to ACAS guidance.** Not legal advice — review with qualified employment solicitors before issue.

---

## 1. Employer and employee

**Employer name:** __________  
**Employee name:** __________  
**Start date:** __________  
**Date statement issued:** __________  

---

## 2. Job title and description

**Job title:** __________  
**Duties:** __________  

---

## 3. Place of work

**Primary location:** __________  
**Other locations:** __________  

---

## 4. Pay

**Rate / salary:** £__________ per __________  
**Pay interval:** __________ (weekly / monthly / four-weekly)  
**Method:** BACS  

---

## 5. Hours of work

**Normal hours:** __________ hours per week  
**Days / shift pattern:** __________  
**Overtime:** __________  

---

## 6. Holiday entitlement

**Annual leave:** __________ days (including bank holidays: __________)  
**Holiday year:** __________ to __________  

---

## 7. Sick pay

**Statutory Sick Pay:** As required by law  
**Company sick pay (if any):** __________  

---

## 8. Pension

Auto-enrolment scheme: __________  

---

## 9. Notice periods

**Employer notice:** __________  
**Employee notice:** __________  

---

## 10. Disciplinary and grievance

Procedures are in the employee handbook / separate policy (ACAS-aligned). Summary available on request.

---

## 11. Training

Mandatory training entitlements (if any): __________  

---

## Signatures

**Employer:** Name __________ Title __________ Signature __________ Date __________  

**Employee:** I confirm receipt of this written statement.

Signature __________ Date __________  

---
_Source structure: [ACAS written statement templates](https://www.acas.org.uk/templates/written-statement-templates). Platform updates when UK law changes._""",
    },
    {
        "id": "job_offer_letter_acas",
        "category": "contracts",
        "title": "Job offer letter",
        "description": "Conditional job offer to a successful candidate — ACAS employer letter structure.",
        "sort_order": 125,
        "version": "1.0",
        "legal_basis": "Employment Rights Act 1996; Equality Act 2010; ACAS recruitment templates",
        "change_summary": "Initial release — ACAS-aligned job offer letter.",
        "source": "acas",
        "source_url": "https://www.acas.org.uk/job-offer-letters",
        "source_label": "ACAS job offer letters",
        "content_markdown": """# Job offer letter

**Private and confidential**

Dear __________,

We are pleased to offer you the position of **__________** at **__________**, subject to the conditions below.

## Role details

- **Start date:** __________  
- **Work location:** __________  
- **Reporting to:** __________  
- **Employment type:** __________ (full-time / part-time / fixed-term)  
- **Salary / hourly rate:** £__________  

## Conditions

This offer is subject to:

- [ ] Satisfactory Right to Work check  
- [ ] Satisfactory references  
- [ ] Signed contract of employment / written statement  
- [ ] Any probation period: __________ months  

## Next steps

Please confirm acceptance by __________ by replying to __________.

If you accept, we will send your contract and onboarding checklist.

Yours sincerely,

__________  
__________  
__________  

---
_Source structure: [ACAS job offer letters](https://www.acas.org.uk/job-offer-letters). Not a binding contract until signed employment terms are agreed._""",
    },
]
