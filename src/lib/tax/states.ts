// US states (and DC) for restaurant addresses, with each state's own sales tax rate on restaurant meals, in basis
// points. These are only the fallback when an address can't be looked up: most places add county and city taxes on
// top, so a restaurant taxed at a state rate is flagged for an admin to check. Where a state taxes prepared meals at
// a special rate (meals and rooms taxes) that rate is used. Rates as of 2026; verify before relying on them.

export type UsState = { code: string; name: string; mealsRateBps: number };

export const US_STATES: UsState[] = [
  { code: 'AL', name: 'Alabama', mealsRateBps: 400 },
  { code: 'AK', name: 'Alaska', mealsRateBps: 0 },
  { code: 'AZ', name: 'Arizona', mealsRateBps: 560 },
  { code: 'AR', name: 'Arkansas', mealsRateBps: 650 },
  { code: 'CA', name: 'California', mealsRateBps: 725 },
  { code: 'CO', name: 'Colorado', mealsRateBps: 290 },
  { code: 'CT', name: 'Connecticut', mealsRateBps: 735 },
  { code: 'DE', name: 'Delaware', mealsRateBps: 0 },
  { code: 'DC', name: 'District of Columbia', mealsRateBps: 1000 },
  { code: 'FL', name: 'Florida', mealsRateBps: 600 },
  { code: 'GA', name: 'Georgia', mealsRateBps: 400 },
  { code: 'HI', name: 'Hawaii', mealsRateBps: 400 },
  { code: 'ID', name: 'Idaho', mealsRateBps: 600 },
  { code: 'IL', name: 'Illinois', mealsRateBps: 625 },
  { code: 'IN', name: 'Indiana', mealsRateBps: 700 },
  { code: 'IA', name: 'Iowa', mealsRateBps: 600 },
  { code: 'KS', name: 'Kansas', mealsRateBps: 650 },
  { code: 'KY', name: 'Kentucky', mealsRateBps: 600 },
  { code: 'LA', name: 'Louisiana', mealsRateBps: 500 },
  { code: 'ME', name: 'Maine', mealsRateBps: 800 },
  { code: 'MD', name: 'Maryland', mealsRateBps: 600 },
  { code: 'MA', name: 'Massachusetts', mealsRateBps: 625 },
  { code: 'MI', name: 'Michigan', mealsRateBps: 600 },
  { code: 'MN', name: 'Minnesota', mealsRateBps: 688 },
  { code: 'MS', name: 'Mississippi', mealsRateBps: 700 },
  { code: 'MO', name: 'Missouri', mealsRateBps: 423 },
  { code: 'MT', name: 'Montana', mealsRateBps: 0 },
  { code: 'NE', name: 'Nebraska', mealsRateBps: 550 },
  { code: 'NV', name: 'Nevada', mealsRateBps: 685 },
  { code: 'NH', name: 'New Hampshire', mealsRateBps: 850 },
  { code: 'NJ', name: 'New Jersey', mealsRateBps: 663 },
  { code: 'NM', name: 'New Mexico', mealsRateBps: 488 },
  { code: 'NY', name: 'New York', mealsRateBps: 400 },
  { code: 'NC', name: 'North Carolina', mealsRateBps: 475 },
  { code: 'ND', name: 'North Dakota', mealsRateBps: 500 },
  { code: 'OH', name: 'Ohio', mealsRateBps: 575 },
  { code: 'OK', name: 'Oklahoma', mealsRateBps: 450 },
  { code: 'OR', name: 'Oregon', mealsRateBps: 0 },
  { code: 'PA', name: 'Pennsylvania', mealsRateBps: 600 },
  { code: 'RI', name: 'Rhode Island', mealsRateBps: 800 },
  { code: 'SC', name: 'South Carolina', mealsRateBps: 600 },
  { code: 'SD', name: 'South Dakota', mealsRateBps: 420 },
  { code: 'TN', name: 'Tennessee', mealsRateBps: 700 },
  { code: 'TX', name: 'Texas', mealsRateBps: 625 },
  { code: 'UT', name: 'Utah', mealsRateBps: 610 },
  { code: 'VT', name: 'Vermont', mealsRateBps: 900 },
  { code: 'VA', name: 'Virginia', mealsRateBps: 530 },
  { code: 'WA', name: 'Washington', mealsRateBps: 650 },
  { code: 'WV', name: 'West Virginia', mealsRateBps: 600 },
  { code: 'WI', name: 'Wisconsin', mealsRateBps: 500 },
  { code: 'WY', name: 'Wyoming', mealsRateBps: 400 },
];

export const STATE_CODES = US_STATES.map((s) => s.code) as [string, ...string[]];
export const stateByCode = (code: string) => US_STATES.find((s) => s.code === code.toUpperCase());
